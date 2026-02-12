#!/usr/bin/env python3
"""
OpenSpec Desktop - macOS native app
- Left: WebView loading the web app
- Right: xterm.js terminal (real PTY via zsh)
- Python GUI coordinates web ↔ terminal
"""

import os
import pty
import re
import select
import signal
import struct
import fcntl
import termios
import threading
import subprocess
import json
import base64
import time
import urllib.request
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

import objc
from Foundation import NSURL, NSURLRequest, NSOperationQueue, NSMakeRange, NSAttributedString
from AppKit import NSForegroundColorAttributeName, NSFontAttributeName
from Cocoa import (
    NSApplication,
    NSWindow,
    NSMakeRect,
    NSBackingStoreBuffered,
    NSWindowStyleMaskTitled,
    NSWindowStyleMaskClosable,
    NSWindowStyleMaskResizable,
    NSWindowStyleMaskMiniaturizable,
    NSSplitView,
    NSObject,
    NSApplicationActivationPolicyRegular,
    NSScreen,
    NSMenu,
    NSMenuItem,
    NSAlert,
    NSAlertFirstButtonReturn,
    NSAlertSecondButtonReturn,
    NSInformationalAlertStyle,
    NSWarningAlertStyle,
    NSScrollView,
    NSTextView,
    NSView,
    NSButton,
    NSFont,
    NSColor,
    NSMakeSize,
)
from WebKit import WKWebView, WKWebViewConfiguration, WKUserContentController, WKUserScript


# ─── Config Persistence ─────────────────────────────────────────────

CONFIG_PATH = os.path.expanduser('~/.openspec_desktop.json')

def load_config() -> dict:
    try:
        with open(CONFIG_PATH, 'r') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def save_config(config: dict):
    try:
        with open(CONFIG_PATH, 'w') as f:
            json.dump(config, f, indent=2)
    except Exception as e:
        print(f"Failed to save config: {e}")


# ─── HTTP Notification Server ──────────────────────────────────────

class HookNotificationHandler(BaseHTTPRequestHandler):
    """HTTP handler for receiving hook notifications from droid."""
    
    coordinator = None  # Will be set by AppCoordinator
    
    def log_message(self, format, *args):
        """Suppress default logging."""
        pass
    
    def do_POST(self):
        """Handle POST requests from droid hooks."""
        if self.path == '/api/hook-notify':
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length).decode('utf-8')
                data = json.loads(body) if body else {}
                
                # Notify the web app to refresh
                if HookNotificationHandler.coordinator:
                    HookNotificationHandler.coordinator.notify_web_refresh(data)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write('{"status":"ok"}'.encode('utf-8'))
            except Exception as e:
                print(f"Hook notification error: {e}")
                self.send_response(500)
                self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()


def start_http_server(coordinator, port=8888):
    """Start HTTP server in background thread."""
    HookNotificationHandler.coordinator = coordinator
    try:
        server = HTTPServer(('127.0.0.1', port), HookNotificationHandler)
    except OSError as e:
        print(f"ERROR: Failed to start hook server on port {port}: {e}")
        print("  Hook notifications from droid/codex will not be received.")
        print(f"  Check if another process is using port {port}: lsof -i :{port}")
        return None
    server.timeout = 1  # prevent blocking on shutdown
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"Hook notification server listening on http://127.0.0.1:{port}")
    return server


# ─── Vite Dev Server Management ────────────────────────────────────

def start_vite_server():
    """Start Vite dev server in the app directory."""
    app_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app')
    app_dir = os.path.abspath(app_dir)
    
    if not os.path.isdir(app_dir):
        print(f"Warning: app directory not found at {app_dir}")
        return None
    
    # Kill any existing process on port 5173 to avoid Vite picking another port
    try:
        result = subprocess.run(
            ['lsof', '-ti', ':5173'],
            capture_output=True, text=True, timeout=5
        )
        for pid in result.stdout.strip().split('\n'):
            if pid.strip():
                os.kill(int(pid.strip()), signal.SIGTERM)
                print(f"Killed existing process on port 5173 (PID: {pid.strip()})")
                time.sleep(0.5)
    except Exception:
        pass
    
    print(f"Starting Vite dev server in {app_dir}...")
    try:
        process = subprocess.Popen(
            ['npm', 'run', 'dev'],
            cwd=app_dir,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            preexec_fn=os.setsid,
        )
        print(f"Vite dev server started (PID: {process.pid})")
        return process
    except Exception as e:
        print(f"Failed to start Vite dev server: {e}")
        return None


def wait_for_vite_ready(url='http://localhost:5173', timeout=30):
    """Wait for Vite dev server to be ready."""
    print(f"Waiting for Vite dev server at {url}...")
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            urllib.request.urlopen(url, timeout=1)
            print("Vite dev server is ready!")
            return True
        except Exception:
            time.sleep(0.5)
    print("Timeout waiting for Vite dev server")
    return False


# ─── PTY Terminal ───────────────────────────────────────────────────

class TerminalSession:
    """Manages a real PTY session."""

    def __init__(self, shell='/bin/zsh'):
        self.shell = shell
        self.cols = 80
        self.rows = 24
        self.master_fd = None
        self.pid = None
        self.on_output = None
        self.on_exit = None
        self._alive = False
        self._started = False

    def start(self, cols=80, rows=24):
        """Start PTY with exact dimensions from xterm.js."""
        if self._started:
            return
        self._started = True
        self.cols = cols
        self.rows = rows

        env = os.environ.copy()
        env['TERM'] = 'xterm-256color'
        env['LANG'] = 'en_US.UTF-8'
        env['LC_ALL'] = 'en_US.UTF-8'
        # Disable zsh auto-title which can cause extra escape sequences
        env['DISABLE_AUTO_TITLE'] = 'true'
        # Bypass proxy for localhost/127.0.0.1 to allow hook notifications
        env['no_proxy'] = '127.0.0.1,localhost'
        env['NO_PROXY'] = '127.0.0.1,localhost'

        pid, fd = pty.fork()
        if pid == 0:
            os.execvpe(self.shell, [self.shell, '-l'], env)
        else:
            self.pid = pid
            self.master_fd = fd
            self._alive = True
            self._set_size(self.cols, self.rows)
            t = threading.Thread(target=self._read_loop, daemon=True)
            t.start()

    def write(self, data: bytes):
        if self.master_fd is not None and self._alive:
            try:
                os.write(self.master_fd, data)
            except OSError:
                pass

    def resize(self, cols: int, rows: int):
        if cols == self.cols and rows == self.rows:
            return
        self.cols = cols
        self.rows = rows
        if self.master_fd is not None and self._alive:
            self._set_size(cols, rows)

    def kill(self):
        self._alive = False
        if self.pid:
            try:
                os.kill(self.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass

    def _set_size(self, cols, rows):
        try:
            winsize = struct.pack('HHHH', rows, cols, 0, 0)
            fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, winsize)
            # Send SIGWINCH to notify the process
            if self.pid:
                os.kill(self.pid, signal.SIGWINCH)
        except (OSError, ProcessLookupError):
            pass

    def _read_loop(self):
        try:
            while self._alive:
                r, _, _ = select.select([self.master_fd], [], [], 0.01)
                if r:
                    try:
                        data = os.read(self.master_fd, 65536)
                        if data and self.on_output:
                            self.on_output(data)
                    except OSError:
                        break
        finally:
            self._alive = False
            if self.on_exit:
                try:
                    _, status = os.waitpid(self.pid, os.WNOHANG)
                    code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else -1
                except ChildProcessError:
                    code = -1
                self.on_exit(code)


# ─── Web → Native Message Handler ──────────────────────────────────

class NativeBridgeHandler(NSObject):

    def initWithCoordinator_(self, coordinator):
        self = objc.super(NativeBridgeHandler, self).init()
        if self is None:
            return None
        self.coordinator = coordinator
        return self

    def userContentController_didReceiveScriptMessage_(self, controller, message):
        try:
            handler_name = message.name()

            # Terminal input handler (keyboard data from embedded xterm.js)
            if handler_name == 'terminalInput':
                data = message.body()
                if isinstance(data, str) and self.coordinator:
                    self.coordinator.write_to_terminal(data)
                return

            # Terminal resize handler
            if handler_name == 'terminalResize':
                body = message.body()
                if isinstance(body, dict) and self.coordinator:
                    cols = int(body.get('cols', 80))
                    rows = int(body.get('rows', 24))
                    self.coordinator.resize_terminal(cols, rows)
                return

            # Native bridge messages
            body = message.body()
            if isinstance(body, str):
                msg = json.loads(body)
            elif isinstance(body, dict):
                msg = body
            else:
                return

            msg_type = msg.get('type')

            # Terminal commands
            if msg_type == 'runCommand':
                command = msg.get('command', '')
                self.coordinator.log('send', 'runCommand', command)
                self.coordinator.write_to_terminal(command + '\n')
            elif msg_type == 'runCommandWithCallback':
                command = msg.get('command', '')
                callback_id = msg.get('callbackId', '')
                prompt_pattern = msg.get('promptPattern', 'shell')  # 'shell' or 'droid'
                self.coordinator.run_command_with_callback(command, callback_id, prompt_pattern)
            elif msg_type == 'writeInput':
                data = msg.get('data', '')
                self.coordinator.write_to_terminal(data)
            elif msg_type == 'startAgent':
                agent_cmd = msg.get('command', '')
                self.coordinator.log('send', 'startAgent', agent_cmd)
                self.coordinator.write_to_terminal(agent_cmd + '\n')
            
            # File system operations
            elif msg_type == 'fs_pickDirectory':
                self._handle_pick_directory(msg)
            elif msg_type == 'fs_readDirectory':
                self._handle_read_directory(msg)
            elif msg_type == 'fs_readFile':
                self._handle_read_file(msg)
            elif msg_type == 'fs_writeFile':
                self._handle_write_file(msg)
            
            # Git operations
            elif msg_type == 'git_status':
                self._handle_git_status(msg)
            elif msg_type == 'git_add':
                self._handle_git_add(msg)
            elif msg_type == 'git_commit':
                self._handle_git_commit(msg)
            elif msg_type == 'git_log':
                self._handle_git_log(msg)
            elif msg_type == 'git_diff':
                self._handle_git_diff(msg)
            elif msg_type == 'git_branch':
                self._handle_git_branch(msg)
            
            # Review terminal commands
            elif msg_type == 'startReviewTerminal':
                project_path = msg.get('projectPath', '')
                self.coordinator.log('send', 'startReviewTerminal', project_path)
                self.coordinator.start_review_terminal(80, 24)
                # Register a callback to detect when the shell prompt is ready
                self.coordinator._review_pending_callbacks['review-shell-ready'] = {
                    'pattern': 'shell',
                    'buffer': '',
                    'command': '(shell startup)',
                }
            elif msg_type == 'writeReviewInput':
                data = msg.get('data', '')
                self.coordinator.write_to_review_terminal(data)
            elif msg_type == 'runReviewCommandWithCallback':
                command = msg.get('command', '')
                callback_id = msg.get('callbackId', '')
                prompt_pattern = msg.get('promptPattern', 'shell')
                self.coordinator.run_review_command_with_callback(command, callback_id, prompt_pattern)
            elif msg_type == 'stopReviewTerminal':
                self.coordinator.log('send', 'stopReviewTerminal', '')
                self.coordinator.stop_review_terminal()
            elif msg_type == 'reviewTerminalResize':
                cols = int(msg.get('cols', 80))
                rows = int(msg.get('rows', 24))
                self.coordinator.resize_review_terminal(cols, rows)

            # Change terminal commands (multi-session)
            elif msg_type == 'startChangeTerminal':
                tab_id = msg.get('tabId', '')
                cols = int(msg.get('cols', 80))
                rows = int(msg.get('rows', 24))
                self.coordinator.log('send', 'startChangeTerminal', f'tab={tab_id}')
                self.coordinator.start_change_terminal(tab_id, cols, rows)
                # Register a callback to detect when the shell prompt is ready
                if tab_id not in self.coordinator._change_pending_callbacks:
                    self.coordinator._change_pending_callbacks[tab_id] = {}
                self.coordinator._change_pending_callbacks[tab_id][f'{tab_id}-shell-ready'] = {
                    'pattern': 'shell',
                    'buffer': '',
                    'command': '(shell startup)',
                }
            elif msg_type == 'writeChangeInput':
                tab_id = msg.get('tabId', '')
                data = msg.get('data', '')
                self.coordinator.write_to_change_terminal(tab_id, data)
            elif msg_type == 'runChangeCommandWithCallback':
                tab_id = msg.get('tabId', '')
                command = msg.get('command', '')
                callback_id = msg.get('callbackId', '')
                prompt_pattern = msg.get('promptPattern', 'shell')
                self.coordinator.run_change_command_with_callback(tab_id, command, callback_id, prompt_pattern)
            elif msg_type == 'stopChangeTerminal':
                tab_id = msg.get('tabId', '')
                self.coordinator.log('send', 'stopChangeTerminal', f'tab={tab_id}')
                self.coordinator.stop_change_terminal(tab_id)
            elif msg_type == 'changeTerminalResize':
                tab_id = msg.get('tabId', '')
                cols = int(msg.get('cols', 80))
                rows = int(msg.get('rows', 24))
                self.coordinator.resize_change_terminal(tab_id, cols, rows)

            # Session tracking for persistence
            elif msg_type == 'trackChangeSession':
                tab_id = msg.get('tabId', '')
                session_id = msg.get('sessionId', '')
                change_id = msg.get('changeId', None)
                if tab_id and session_id:
                    self.coordinator.active_change_sessions[tab_id] = {
                        'sessionId': session_id,
                        'changeId': change_id,
                    }
                    self.coordinator.log('info', 'trackChangeSession', f'tab={tab_id}, session={session_id}, change={change_id}')
            elif msg_type == 'untrackChangeSession':
                tab_id = msg.get('tabId', '')
                self.coordinator.active_change_sessions.pop(tab_id, None)
                self.coordinator.log('info', 'untrackChangeSession', f'tab={tab_id}')
            elif msg_type == 'trackCodexSession':
                tab_id = msg.get('tabId', '')
                session_id = msg.get('sessionId', '')
                change_id = msg.get('changeId', None)
                if tab_id and session_id:
                    self.coordinator.active_codex_sessions[tab_id] = {
                        'sessionId': session_id,
                        'changeId': change_id,
                    }
                    self.coordinator.log('info', 'trackCodexSession', f'tab={tab_id}, session={session_id}, change={change_id}')
            elif msg_type == 'untrackCodexSession':
                tab_id = msg.get('tabId', '')
                self.coordinator.active_codex_sessions.pop(tab_id, None)
                self.coordinator.log('info', 'untrackCodexSession', f'tab={tab_id}')

        except Exception as e:
            print(f"NativeBridgeHandler error: {e}")

    def _handle_pick_directory(self, msg):
        """Show native directory picker and return path."""
        from Cocoa import NSOpenPanel, NSModalResponseOK
        request_id = msg.get('requestId')
        
        def do_pick():
            panel = NSOpenPanel.alloc().init()
            panel.setCanChooseFiles_(False)
            panel.setCanChooseDirectories_(True)
            panel.setAllowsMultipleSelection_(False)
            panel.setMessage_("Select OpenSpec directory")
            
            if panel.runModal() == NSModalResponseOK:
                url = panel.URLs()[0]
                path = url.path()
                # Save last opened directory
                config = load_config()
                config['lastDirectory'] = path
                save_config(config)
                self._send_response(request_id, {'success': True, 'path': path})
            else:
                self._send_response(request_id, {'success': False, 'error': 'User cancelled'})
        
        NSOperationQueue.mainQueue().addOperationWithBlock_(do_pick)

    def _handle_read_directory(self, msg):
        """Read directory contents recursively."""
        request_id = msg.get('requestId')
        path = msg.get('path', '')
        
        try:
            result = self._read_dir_recursive(path)
            self._send_response(request_id, {'success': True, 'data': result})
        except Exception as e:
            self._send_response(request_id, {'success': False, 'error': str(e)})

    def _read_dir_recursive(self, path: str) -> dict:
        """Recursively read directory structure."""
        if not os.path.isdir(path):
            raise ValueError(f"Not a directory: {path}")
        
        entries = []
        try:
            for name in os.listdir(path):
                if name.startswith('.'):
                    continue
                full_path = os.path.join(path, name)
                if os.path.isdir(full_path):
                    entries.append({
                        'name': name,
                        'kind': 'directory',
                        'path': full_path
                    })
                elif os.path.isfile(full_path):
                    entries.append({
                        'name': name,
                        'kind': 'file',
                        'path': full_path
                    })
        except PermissionError:
            pass
        
        return {
            'name': os.path.basename(path),
            'kind': 'directory',
            'path': path,
            'entries': sorted(entries, key=lambda x: (x['kind'] != 'directory', x['name']))
        }

    def _handle_read_file(self, msg):
        """Read file contents."""
        request_id = msg.get('requestId')
        path = msg.get('path', '')
        
        try:
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
            self._send_response(request_id, {'success': True, 'content': content})
        except Exception as e:
            self._send_response(request_id, {'success': False, 'error': str(e)})

    def _handle_write_file(self, msg):
        """Write file contents."""
        request_id = msg.get('requestId')
        path = msg.get('path', '')
        content = msg.get('content', '')
        
        try:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(content)
            self._send_response(request_id, {'success': True})
        except Exception as e:
            self._send_response(request_id, {'success': False, 'error': str(e)})

    # ─── Git Operations ───

    def _run_git(self, args: list, cwd: str) -> dict:
        """Run a git command and return stdout/stderr/returncode."""
        try:
            result = subprocess.run(
                ['git'] + args,
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=30,
            )
            return {
                'stdout': result.stdout,
                'stderr': result.stderr,
                'returncode': result.returncode,
            }
        except subprocess.TimeoutExpired:
            return {'stdout': '', 'stderr': 'Git command timed out', 'returncode': -1}
        except FileNotFoundError:
            return {'stdout': '', 'stderr': 'git not found on system', 'returncode': -1}
        except Exception as e:
            return {'stdout': '', 'stderr': str(e), 'returncode': -1}

    def _handle_git_status(self, msg):
        """Get git status for a repo path."""
        request_id = msg.get('requestId')
        path = msg.get('path', '')

        def do_status():
            r = self._run_git(['status', '--porcelain=v1'], path)
            if r['returncode'] != 0:
                self._send_response(request_id, {'success': False, 'error': r['stderr'].strip()})
                return

            files = []
            for line in r['stdout'].splitlines():
                if len(line) < 4:
                    continue
                index_status = line[0]
                work_status = line[1]
                filepath = line[3:]
                files.append({
                    'index': index_status,
                    'working': work_status,
                    'path': filepath,
                })

            # Also get current branch
            br = self._run_git(['branch', '--show-current'], path)
            branch = br['stdout'].strip() if br['returncode'] == 0 else ''

            self._send_response(request_id, {
                'success': True,
                'branch': branch,
                'files': files,
                'clean': len(files) == 0,
            })

        threading.Thread(target=do_status, daemon=True).start()

    def _handle_git_add(self, msg):
        """Stage files for commit."""
        request_id = msg.get('requestId')
        path = msg.get('path', '')
        files = msg.get('files', [])  # list of file paths, or ['.'] for all

        def do_add():
            if not files:
                self._send_response(request_id, {'success': False, 'error': 'No files specified'})
                return
            r = self._run_git(['add'] + files, path)
            if r['returncode'] == 0:
                self._send_response(request_id, {'success': True})
            else:
                self._send_response(request_id, {'success': False, 'error': r['stderr'].strip()})

        threading.Thread(target=do_add, daemon=True).start()

    def _handle_git_commit(self, msg):
        """Create a git commit."""
        request_id = msg.get('requestId')
        path = msg.get('path', '')
        message = msg.get('message', '')

        def do_commit():
            if not message:
                self._send_response(request_id, {'success': False, 'error': 'Commit message is required'})
                return
            r = self._run_git(['commit', '-m', message], path)
            if r['returncode'] == 0:
                # Parse commit hash from output
                commit_hash = ''
                h = self._run_git(['rev-parse', '--short', 'HEAD'], path)
                if h['returncode'] == 0:
                    commit_hash = h['stdout'].strip()
                self._send_response(request_id, {
                    'success': True,
                    'hash': commit_hash,
                    'output': r['stdout'].strip(),
                })
            else:
                self._send_response(request_id, {'success': False, 'error': r['stderr'].strip() or r['stdout'].strip()})

        threading.Thread(target=do_commit, daemon=True).start()

    def _handle_git_log(self, msg):
        """Get recent git log entries."""
        request_id = msg.get('requestId')
        path = msg.get('path', '')
        count = msg.get('count', 20)

        def do_log():
            r = self._run_git([
                'log', f'-{count}',
                '--pretty=format:%H%n%h%n%an%n%ae%n%at%n%s%n---END---'
            ], path)
            if r['returncode'] != 0:
                self._send_response(request_id, {'success': False, 'error': r['stderr'].strip()})
                return

            commits = []
            entries = r['stdout'].split('---END---')
            for entry in entries:
                lines = entry.strip().splitlines()
                if len(lines) >= 6:
                    commits.append({
                        'hash': lines[0],
                        'shortHash': lines[1],
                        'author': lines[2],
                        'email': lines[3],
                        'timestamp': int(lines[4]),
                        'message': lines[5],
                    })

            self._send_response(request_id, {'success': True, 'commits': commits})

        threading.Thread(target=do_log, daemon=True).start()

    def _handle_git_diff(self, msg):
        """Get diff output."""
        request_id = msg.get('requestId')
        path = msg.get('path', '')
        staged = msg.get('staged', False)
        file_path = msg.get('file', None)

        def do_diff():
            args = ['diff']
            if staged:
                args.append('--cached')
            if file_path:
                args.extend(['--', file_path])
            r = self._run_git(args, path)
            if r['returncode'] == 0:
                self._send_response(request_id, {'success': True, 'diff': r['stdout']})
            else:
                self._send_response(request_id, {'success': False, 'error': r['stderr'].strip()})

        threading.Thread(target=do_diff, daemon=True).start()

    def _handle_git_branch(self, msg):
        """List branches or get current branch."""
        request_id = msg.get('requestId')
        path = msg.get('path', '')

        def do_branch():
            r = self._run_git(['branch', '-a', '--format=%(refname:short) %(HEAD)'], path)
            if r['returncode'] != 0:
                self._send_response(request_id, {'success': False, 'error': r['stderr'].strip()})
                return

            branches = []
            current = ''
            for line in r['stdout'].splitlines():
                parts = line.strip().rsplit(' ', 1)
                if len(parts) == 2:
                    name, head = parts
                    is_current = head == '*'
                    branches.append({'name': name, 'current': is_current})
                    if is_current:
                        current = name

            self._send_response(request_id, {
                'success': True,
                'branches': branches,
                'current': current,
            })

        threading.Thread(target=do_branch, daemon=True).start()

    def _send_response(self, request_id, data):
        """Send response back to WebView."""
        if not self.coordinator or not self.coordinator.webview:
            return
        payload = json.dumps({'requestId': request_id, **data}, ensure_ascii=False)
        b64 = base64.b64encode(payload.encode('utf-8')).decode('ascii')
        js = f"""
        if (window.__nativeBridgeResponse) {{
            try {{
                var b = atob('{b64}');
                var a = new Uint8Array(b.length);
                for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
                var text = new TextDecoder('utf-8').decode(a);
                window.__nativeBridgeResponse(JSON.parse(text));
            }} catch (e) {{
                console.error('[NativeBridge] Failed to parse response:', e);
            }}
        }}
        """
        def do_eval():
            self.coordinator.webview.evaluateJavaScript_completionHandler_(js, None)
        NSOperationQueue.mainQueue().addOperationWithBlock_(do_eval)


# ─── App Coordinator ───────────────────────────────────────────────

class AppCoordinator:

    def __init__(self):
        self.terminal = TerminalSession(shell='/bin/zsh')
        self.review_terminal = TerminalSession(shell='/bin/zsh')
        self.change_terminals = {}  # {tab_id: TerminalSession}
        self.webview = None
        self.log_textview = None  # NSTextView for message log
        self._log_auto_scroll = True
        self._log_max_entries = 2000
        self._log_entry_count = 0
        self._terminal_ready = False
        self._review_terminal_ready = False
        self._pending_callbacks = {}  # {callback_id: {'pattern': 'shell'|'droid', 'buffer': ''}}
        self._review_pending_callbacks = {}  # {callback_id: {'pattern': 'shell'|'droid', 'buffer': ''}}
        self._change_pending_callbacks = {}  # {tab_id: {callback_id: {...}}}
        self._output_buffer = ''
        # Track active sessions for persistence
        self.active_change_sessions = {}  # {tab_id: {'sessionId': str, 'changeId': str|None}}
        self.active_codex_sessions = {}  # {tab_id: {'sessionId': str, 'changeId': str|None}}

    # ─── Log Panel (NSTextView) ─────────────────────────────────────

    # Direction → (label, r, g, b)
    _LOG_STYLES = {
        'send':     ('→ SEND',     0.29, 0.87, 0.50),  # green
        'recv':     ('← RECV',     0.38, 0.65, 0.98),  # blue
        'callback': ('⟲ CALLBACK', 0.98, 0.75, 0.14),  # yellow
        'hook':     ('⚡ HOOK',     0.75, 0.52, 0.99),  # purple
        'info':     ('ℹ INFO',     0.53, 0.53, 0.67),  # gray
    }

    def log(self, direction: str, msg_type: str, detail: str = ''):
        """Append a log entry to the NSTextView log panel.
        direction: 'send' | 'recv' | 'callback' | 'hook' | 'info'
        """
        if not self.log_textview:
            return

        # Truncate detail
        if len(detail) > 500:
            detail = detail[:500] + '...'

        # Build formatted line
        ts = time.strftime('%H:%M:%S', time.localtime())
        ms = f'{int(time.time() * 1000) % 1000:03d}'
        label, r, g, b = self._LOG_STYLES.get(direction, ('ℹ INFO', 0.53, 0.53, 0.67))
        line = f'{ts}.{ms}  {label:<12} {msg_type:<24} {detail}\n'

        # Build attributed string
        attrs = {
            NSFontAttributeName: NSFont.fontWithName_size_('Menlo', 11.0) or NSFont.monospacedSystemFontOfSize_weight_(11.0, 0),
            NSForegroundColorAttributeName: NSColor.colorWithCalibratedRed_green_blue_alpha_(r, g, b, 1.0),
        }
        attr_str = NSAttributedString.alloc().initWithString_attributes_(line, attrs)

        def do_append():
            tv = self.log_textview
            if not tv:
                return
            storage = tv.textStorage()
            storage.beginEditing()
            storage.appendAttributedString_(attr_str)
            self._log_entry_count += 1
            # Trim old entries (approximate: each entry is one line)
            if self._log_entry_count > self._log_max_entries:
                text = storage.string()
                # Find the position after the first 200 lines to trim in bulk
                trim_count = 200
                pos = 0
                for _ in range(trim_count):
                    idx = text.find('\n', pos)
                    if idx == -1:
                        break
                    pos = idx + 1
                if pos > 0:
                    storage.deleteCharactersInRange_(NSMakeRange(0, pos))
                    self._log_entry_count -= trim_count
            storage.endEditing()
            # Auto-scroll to bottom
            if self._log_auto_scroll:
                end = storage.length()
                tv.scrollRangeToVisible_(NSMakeRange(end, 0))

        NSOperationQueue.mainQueue().addOperationWithBlock_(do_append)

    def log_clear(self):
        """Clear all log entries."""
        if not self.log_textview:
            return
        def do_clear():
            storage = self.log_textview.textStorage()
            storage.beginEditing()
            storage.deleteCharactersInRange_(NSMakeRange(0, storage.length()))
            storage.endEditing()
            self._log_entry_count = 0
        NSOperationQueue.mainQueue().addOperationWithBlock_(do_clear)

    def log_toggle_auto_scroll(self):
        """Toggle auto-scroll behavior."""
        self._log_auto_scroll = not self._log_auto_scroll
        return self._log_auto_scroll

    # ─── Terminal ───────────────────────────────────────────────────

    def start_terminal(self, cols=80, rows=24):
        """Start the PTY. Can be called multiple times safely."""
        if self.terminal._started:
            return
        self.log('info', 'start_terminal', f'PTY size {cols}x{rows}')
        self.terminal.on_output = self._on_terminal_output
        self.terminal.on_exit = self._on_terminal_exit
        self.terminal.start(cols, rows)
        self._terminal_ready = True

    def write_to_terminal(self, text: str):
        self.terminal.write(text.encode('utf-8'))

    def run_command_with_callback(self, command: str, callback_id: str, prompt_pattern: str = 'shell'):
        """Run a command and call back when prompt is detected again."""
        self._pending_callbacks[callback_id] = {
            'pattern': prompt_pattern,
            'buffer': '',
            'command': command,
        }
        self.log('send', 'runCommandWithCallback', f'{command}  [cb={callback_id}, wait={prompt_pattern}]')
        self.terminal.write((command + '\n').encode('utf-8'))

    def resize_terminal(self, cols: int, rows: int):
        if not self.terminal._started:
            # First resize = initial size, start the PTY
            self.start_terminal(cols, rows)
        else:
            self.terminal.resize(cols, rows)

    # ANSI escape sequence pattern for stripping from prompt detection
    _ansi_re = re.compile(r'\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b\[.*?\x07|\x1b[()][AB012]|\x1b\[\?[0-9;]*[hl]')

    # Shell prompt patterns: ends with $, %, ❯, > (with optional trailing space)
    _shell_prompt_re = re.compile(r'[$%❯>]\s*$')
    # Droid prompt patterns: ends with >, ❯, or contains "How can I help"
    _droid_prompt_re = re.compile(r'[>❯]\s*$|How can I help')

    def _on_terminal_output(self, data: bytes):
        self._send_to_webview(data)

        # Check pending callbacks for prompt detection
        if self._pending_callbacks:
            try:
                text = data.decode('utf-8', errors='replace')
            except Exception:
                return

            # Process each pending callback
            completed = []
            for cb_id, cb_info in self._pending_callbacks.items():
                cb_info['buffer'] += text
                # Strip ANSI escape sequences for clean prompt detection
                clean = self._ansi_re.sub('', cb_info['buffer'])
                # Only check the last 200 chars to avoid false matches on old output
                tail = clean[-200:]

                matched = False
                if cb_info['pattern'] == 'shell':
                    matched = bool(self._shell_prompt_re.search(tail))
                elif cb_info['pattern'] == 'droid':
                    matched = bool(self._droid_prompt_re.search(tail))

                if matched:
                    completed.append(cb_id)
                    self._fire_callback(cb_id, cb_info['buffer'])

            for cb_id in completed:
                del self._pending_callbacks[cb_id]

    def _fire_callback(self, callback_id: str, output: str):
        """Notify web app that a command has completed."""
        if not self.webview:
            return
        # Escape for JS string
        safe_output = output.replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n').replace('\r', '\\r')
        # Truncate output to avoid JS string limits
        if len(safe_output) > 10000:
            safe_output = safe_output[-10000:]
        js = f"""
        if (window.__onCommandCallback) {{
            window.__onCommandCallback('{callback_id}', '{safe_output}');
        }}
        """
        def do_eval():
            self.webview.evaluateJavaScript_completionHandler_(js, None)
        NSOperationQueue.mainQueue().addOperationWithBlock_(do_eval)
        self.log('callback', 'command_complete', f'[{callback_id}]')

    def _on_terminal_exit(self, code: int):
        msg = f"\r\n[Process exited with code {code}]\r\n"
        self.log('info', 'terminal_exit', f'code={code}')
        self._send_to_webview(msg.encode('utf-8'))

    def _send_to_webview(self, data: bytes):
        if not self.webview:
            return
        b64 = base64.b64encode(data).decode('ascii')
        js = f"""
        if (window.__onTerminalOutputBytes) {{
            window.__onTerminalOutputBytes('{b64}');
        }} else if (window.__onTerminalOutput) {{
            var b = atob('{b64}');
            var a = new Uint8Array(b.length);
            for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
            window.__onTerminalOutput(new TextDecoder().decode(a));
        }}
        """
        def do_eval():
            self.webview.evaluateJavaScript_completionHandler_(js, None)
        NSOperationQueue.mainQueue().addOperationWithBlock_(do_eval)

    # ─── Review Terminal ──────────────────────────────────────────

    def start_review_terminal(self, cols=80, rows=24):
        """Start the review PTY. Can be called multiple times safely."""
        if self.review_terminal._started:
            return
        self.log('info', 'start_review_terminal', f'Review PTY size {cols}x{rows}')
        self.review_terminal.on_output = self._on_review_terminal_output
        self.review_terminal.on_exit = self._on_review_terminal_exit
        self.review_terminal.start(cols, rows)
        self._review_terminal_ready = True

    def write_to_review_terminal(self, text: str):
        self.review_terminal.write(text.encode('utf-8'))

    def run_review_command_with_callback(self, command: str, callback_id: str, prompt_pattern: str = 'shell'):
        """Run a command in review terminal and call back when prompt is detected."""
        self._review_pending_callbacks[callback_id] = {
            'pattern': prompt_pattern,
            'buffer': '',
            'command': command,
        }
        self.log('send', 'runReviewCommandWithCallback', f'{command}  [cb={callback_id}, wait={prompt_pattern}]')
        self.review_terminal.write((command + '\n').encode('utf-8'))

    def stop_review_terminal(self):
        """Stop the review PTY and release resources."""
        if self.review_terminal._alive:
            self.log('info', 'stop_review_terminal', 'Killing review PTY')
            self.review_terminal.kill()
        # Clear pending review callbacks
        self._review_pending_callbacks.clear()
        # Create a fresh session for next use
        self.review_terminal = TerminalSession(shell='/bin/zsh')
        self._review_terminal_ready = False

    def resize_review_terminal(self, cols: int, rows: int):
        """Resize the review PTY to match xterm.js dimensions."""
        if self.review_terminal._started:
            self.log('info', 'resize_review_terminal', f'{cols}x{rows}')
            self.review_terminal.resize(cols, rows)

    def _on_review_terminal_output(self, data: bytes):
        """Send review terminal output to the web app."""
        if not self.webview:
            return
        b64 = base64.b64encode(data).decode('ascii')
        js = f"""
        if (window.__onReviewTerminalOutputBytes) {{
            window.__onReviewTerminalOutputBytes('{b64}');
        }} else if (window.__onReviewTerminalOutput) {{
            var b = atob('{b64}');
            var a = new Uint8Array(b.length);
            for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
            window.__onReviewTerminalOutput(new TextDecoder().decode(a));
        }}
        """
        def do_eval():
            self.webview.evaluateJavaScript_completionHandler_(js, None)
        NSOperationQueue.mainQueue().addOperationWithBlock_(do_eval)

        # Check pending review callbacks for prompt detection
        if self._review_pending_callbacks:
            try:
                text = data.decode('utf-8', errors='replace')
            except Exception:
                return

            completed = []
            for cb_id, cb_info in self._review_pending_callbacks.items():
                cb_info['buffer'] += text
                clean = self._ansi_re.sub('', cb_info['buffer'])
                tail = clean[-200:]

                matched = False
                if cb_info['pattern'] == 'shell':
                    matched = bool(self._shell_prompt_re.search(tail))
                elif cb_info['pattern'] == 'droid':
                    matched = bool(self._droid_prompt_re.search(tail))

                if matched:
                    completed.append(cb_id)
                    self._fire_review_callback(cb_id, cb_info['buffer'])

            for cb_id in completed:
                del self._review_pending_callbacks[cb_id]

    def _fire_review_callback(self, callback_id: str, output: str):
        """Notify web app that a review command has completed."""
        if not self.webview:
            return
        safe_output = output.replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n').replace('\r', '\\r')
        if len(safe_output) > 10000:
            safe_output = safe_output[-10000:]
        js = f"""
        if (window.__onReviewCommandCallback) {{
            window.__onReviewCommandCallback('{callback_id}', '{safe_output}');
        }}
        """
        def do_eval():
            self.webview.evaluateJavaScript_completionHandler_(js, None)
        NSOperationQueue.mainQueue().addOperationWithBlock_(do_eval)
        self.log('callback', 'review_command_complete', f'[{callback_id}]')

    def _on_review_terminal_exit(self, code: int):
        """Handle review terminal exit."""
        self.log('info', 'review_terminal_exit', f'code={code}')
        # Notify web app that review terminal exited
        if self.webview:
            js = f"""
            if (window.__onReviewTerminalExit) {{
                window.__onReviewTerminalExit({code});
            }}
            """
            def do_eval():
                self.webview.evaluateJavaScript_completionHandler_(js, None)
            NSOperationQueue.mainQueue().addOperationWithBlock_(do_eval)

    # ─── Change Terminals (Multiple Independent Sessions) ──────────

    def start_change_terminal(self, tab_id: str, cols=80, rows=24):
        """Start a new PTY session for a change tab."""
        if tab_id in self.change_terminals and self.change_terminals[tab_id]._started:
            return
        self.log('info', 'start_change_terminal', f'tab={tab_id}, size={cols}x{rows}')
        terminal = TerminalSession(shell='/bin/zsh')
        terminal.on_output = lambda data: self._on_change_terminal_output(tab_id, data)
        terminal.on_exit = lambda code: self._on_change_terminal_exit(tab_id, code)
        terminal.start(cols, rows)
        self.change_terminals[tab_id] = terminal
        self._change_pending_callbacks[tab_id] = {}

    def write_to_change_terminal(self, tab_id: str, text: str):
        """Write input to a specific change terminal."""
        if tab_id in self.change_terminals:
            self.change_terminals[tab_id].write(text.encode('utf-8'))

    def run_change_command_with_callback(self, tab_id: str, command: str, callback_id: str, prompt_pattern: str = 'shell'):
        """Run a command in a change terminal and call back when prompt is detected."""
        if tab_id not in self._change_pending_callbacks:
            self._change_pending_callbacks[tab_id] = {}
        self._change_pending_callbacks[tab_id][callback_id] = {
            'pattern': prompt_pattern,
            'buffer': '',
            'command': command,
        }
        self.log('send', 'runChangeCommandWithCallback', f'tab={tab_id}, cmd={command}, cb={callback_id}')
        if tab_id in self.change_terminals:
            self.change_terminals[tab_id].write((command + '\n').encode('utf-8'))

    def stop_change_terminal(self, tab_id: str):
        """Stop a change terminal and release resources."""
        if tab_id in self.change_terminals:
            terminal = self.change_terminals[tab_id]
            if terminal._alive:
                self.log('info', 'stop_change_terminal', f'tab={tab_id}')
                terminal.kill()
            del self.change_terminals[tab_id]
        if tab_id in self._change_pending_callbacks:
            del self._change_pending_callbacks[tab_id]

    def resize_change_terminal(self, tab_id: str, cols: int, rows: int):
        """Resize a change terminal."""
        if tab_id in self.change_terminals and self.change_terminals[tab_id]._started:
            self.change_terminals[tab_id].resize(cols, rows)

    def _on_change_terminal_output(self, tab_id: str, data: bytes):
        """Send change terminal output to the web app."""
        if not self.webview:
            return
        b64 = base64.b64encode(data).decode('ascii')
        safe_tab_id = tab_id.replace('\\', '\\\\').replace("'", "\\'")
        js = f"""
        if (window.__onChangeTerminalOutputBytes && window.__onChangeTerminalOutputBytes['{safe_tab_id}']) {{
            window.__onChangeTerminalOutputBytes['{safe_tab_id}']('{b64}');
        }} else if (window.__onChangeTerminalOutput && window.__onChangeTerminalOutput['{safe_tab_id}']) {{
            var b = atob('{b64}');
            var a = new Uint8Array(b.length);
            for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
            window.__onChangeTerminalOutput['{safe_tab_id}'](new TextDecoder().decode(a));
        }}
        """
        def do_eval():
            self.webview.evaluateJavaScript_completionHandler_(js, None)
        NSOperationQueue.mainQueue().addOperationWithBlock_(do_eval)

        # Check pending callbacks for prompt detection
        if tab_id in self._change_pending_callbacks and self._change_pending_callbacks[tab_id]:
            try:
                text = data.decode('utf-8', errors='replace')
            except Exception:
                return

            completed = []
            for cb_id, cb_info in self._change_pending_callbacks[tab_id].items():
                cb_info['buffer'] += text
                clean = self._ansi_re.sub('', cb_info['buffer'])
                tail = clean[-200:]

                matched = False
                if cb_info['pattern'] == 'shell':
                    matched = bool(self._shell_prompt_re.search(tail))
                elif cb_info['pattern'] == 'droid':
                    matched = bool(self._droid_prompt_re.search(tail))

                if matched:
                    completed.append(cb_id)
                    self._fire_change_callback(tab_id, cb_id, cb_info['buffer'])

            for cb_id in completed:
                del self._change_pending_callbacks[tab_id][cb_id]

    def _fire_change_callback(self, tab_id: str, callback_id: str, output: str):
        """Notify web app that a change terminal command has completed."""
        if not self.webview:
            return
        safe_output = output.replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n').replace('\r', '\\r')
        if len(safe_output) > 10000:
            safe_output = safe_output[-10000:]
        safe_tab_id = tab_id.replace('\\', '\\\\').replace("'", "\\'")
        js = f"""
        if (window.__onChangeCommandCallback && window.__onChangeCommandCallback['{safe_tab_id}']) {{
            window.__onChangeCommandCallback['{safe_tab_id}']('{callback_id}', '{safe_output}');
        }}
        """
        def do_eval():
            self.webview.evaluateJavaScript_completionHandler_(js, None)
        NSOperationQueue.mainQueue().addOperationWithBlock_(do_eval)
        self.log('callback', 'change_command_complete', f'tab={tab_id}, cb={callback_id}')

    def _on_change_terminal_exit(self, tab_id: str, code: int):
        """Handle change terminal exit."""
        self.log('info', 'change_terminal_exit', f'tab={tab_id}, code={code}')
        if self.webview:
            safe_tab_id = tab_id.replace('\\', '\\\\').replace("'", "\\'")
            js = f"""
            if (window.__onChangeTerminalExit && window.__onChangeTerminalExit['{safe_tab_id}']) {{
                window.__onChangeTerminalExit['{safe_tab_id}']({code});
            }}
            """
            def do_eval():
                self.webview.evaluateJavaScript_completionHandler_(js, None)
            NSOperationQueue.mainQueue().addOperationWithBlock_(do_eval)

    def notify_web_refresh(self, data: dict):
        """Notify the web app that a hook event occurred (e.g. file changed, session ended)."""
        if not self.webview:
            print("[notify_web_refresh] No webview, skipping")
            return
        # Normalize event name: hook stdin uses 'hook_event_name', our old format used 'event'
        event_name = data.get('hook_event_name', data.get('event', 'unknown'))
        data['event'] = event_name
        # Use base64 encoding to avoid all JS string escaping issues.
        # The payload may contain arbitrary text (e.g. last_result with markdown,
        # backticks, quotes, newlines, unicode) that would break inline JS strings.
        try:
            payload_json = json.dumps(data, ensure_ascii=False)
        except (TypeError, ValueError) as e:
            print(f"[notify_web_refresh] JSON encode error: {e}")
            return
        b64 = base64.b64encode(payload_json.encode('utf-8')).decode('ascii')
        js = f"""
        if (window.__onHookNotify) {{
            try {{
                var b = atob('{b64}');
                var a = new Uint8Array(b.length);
                for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
                var text = new TextDecoder('utf-8').decode(a);
                window.__onHookNotify(JSON.parse(text));
            }} catch(e) {{
                console.error('[HookNotify] Failed to parse payload:', e);
            }}
        }} else {{
            console.warn('[HookNotify] window.__onHookNotify not defined');
        }}
        """
        def do_eval():
            self.webview.evaluateJavaScript_completionHandler_(js, None)
        NSOperationQueue.mainQueue().addOperationWithBlock_(do_eval)
        # Log to log panel (filter to safe keys only)
        log_keys = ('tool_name', 'session_id', 'reason', 'source', 'hook_event_name', 'event')
        log_data = {k: v for k, v in data.items() if k in log_keys}
        self.log('hook', event_name, json.dumps(log_data, ensure_ascii=False))


# ─── WKUIDelegate for JS alert/confirm/prompt ─────────────────────

class WebViewUIDelegate(NSObject):
    """Handle JavaScript alert(), confirm(), and prompt() dialogs in WKWebView."""

    def webView_runJavaScriptAlertPanelWithMessage_initiatedByFrame_completionHandler_(
        self, webView, message, frame, completionHandler
    ):
        alert = NSAlert.alloc().init()
        alert.setMessageText_(message)
        alert.setAlertStyle_(NSInformationalAlertStyle)
        alert.addButtonWithTitle_("OK")
        alert.runModal()
        completionHandler()

    def webView_runJavaScriptConfirmPanelWithMessage_initiatedByFrame_completionHandler_(
        self, webView, message, frame, completionHandler
    ):
        alert = NSAlert.alloc().init()
        alert.setMessageText_(message)
        alert.setAlertStyle_(NSWarningAlertStyle)
        alert.addButtonWithTitle_("OK")
        alert.addButtonWithTitle_("Cancel")
        result = alert.runModal()
        completionHandler(result == NSAlertFirstButtonReturn)

    def webView_runJavaScriptTextInputPanelWithPrompt_defaultText_initiatedByFrame_completionHandler_(
        self, webView, prompt, defaultText, frame, completionHandler
    ):
        from Cocoa import NSTextField
        alert = NSAlert.alloc().init()
        alert.setMessageText_(prompt)
        alert.addButtonWithTitle_("OK")
        alert.addButtonWithTitle_("Cancel")
        input_field = NSTextField.alloc().initWithFrame_(NSMakeRect(0, 0, 300, 24))
        if defaultText:
            input_field.setStringValue_(defaultText)
        alert.setAccessoryView_(input_field)
        result = alert.runModal()
        if result == NSAlertFirstButtonReturn:
            completionHandler(input_field.stringValue())
        else:
            completionHandler(None)


# ─── Log Panel Toolbar Actions ─────────────────────────────────────

class LogPanelActions(NSObject):
    """Handle button clicks for the log panel toolbar."""

    def initWithCoordinator_(self, coordinator):
        self = objc.super(LogPanelActions, self).init()
        if self is None:
            return None
        self.coordinator = coordinator
        self.auto_scroll_btn = None
        return self

    def clearLog_(self, sender):
        if self.coordinator:
            self.coordinator.log_clear()

    def toggleAutoScroll_(self, sender):
        if self.coordinator:
            on = self.coordinator.log_toggle_auto_scroll()
            if self.auto_scroll_btn:
                self.auto_scroll_btn.setTitle_(f"Auto-scroll: {'ON' if on else 'OFF'}")


def build_log_panel(coordinator, frame):
    """Build the native log panel: toolbar + NSScrollView + NSTextView.
    Returns (container_view, text_view, actions_delegate).
    """
    w = frame.size.width
    h = frame.size.height
    toolbar_h = 26

    container = NSView.alloc().initWithFrame_(frame)

    # ── Toolbar (NSBox for colored background) ──
    from Cocoa import NSBox, NSTextField
    toolbar = NSBox.alloc().initWithFrame_(NSMakeRect(0, h - toolbar_h, w, toolbar_h))
    toolbar.setBoxType_(4)  # NSBoxCustom
    toolbar.setFillColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(0.086, 0.086, 0.165, 1.0))
    toolbar.setBorderWidth_(0)
    toolbar.setTitlePosition_(0)  # NSNoTitle
    toolbar.setAutoresizingMask_(1 << 1 | 1 << 4)  # NSViewWidthSizable | NSViewMinYMargin

    # Title label
    title = NSTextField.alloc().initWithFrame_(NSMakeRect(10, 3, 150, 18))
    title.setStringValue_("📋 Message Log")
    title.setBezeled_(False)
    title.setDrawsBackground_(False)
    title.setEditable_(False)
    title.setSelectable_(False)
    title.setTextColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(0.53, 0.53, 0.67, 1.0))
    title.setFont_(NSFont.boldSystemFontOfSize_(11.0))
    toolbar.addSubview_(title)

    # Actions delegate
    actions = LogPanelActions.alloc().initWithCoordinator_(coordinator)

    # Auto-scroll button
    auto_btn = NSButton.alloc().initWithFrame_(NSMakeRect(w - 200, 2, 110, 20))
    auto_btn.setTitle_("Auto-scroll: ON")
    auto_btn.setBezelStyle_(14)  # NSBezelStyleRecessed
    auto_btn.setFont_(NSFont.systemFontOfSize_(10.0))
    auto_btn.setTarget_(actions)
    auto_btn.setAction_(objc.selector(actions.toggleAutoScroll_, signature=b'v@:@'))
    auto_btn.setAutoresizingMask_(1 << 0)  # NSViewMinXMargin
    actions.auto_scroll_btn = auto_btn
    toolbar.addSubview_(auto_btn)

    # Clear button
    clear_btn = NSButton.alloc().initWithFrame_(NSMakeRect(w - 80, 2, 60, 20))
    clear_btn.setTitle_("Clear")
    clear_btn.setBezelStyle_(14)  # NSBezelStyleRecessed
    clear_btn.setFont_(NSFont.systemFontOfSize_(10.0))
    clear_btn.setTarget_(actions)
    clear_btn.setAction_(objc.selector(actions.clearLog_, signature=b'v@:@'))
    clear_btn.setAutoresizingMask_(1 << 0)  # NSViewMinXMargin
    toolbar.addSubview_(clear_btn)

    container.addSubview_(toolbar)

    # ── Scroll View + Text View ──
    scroll_frame = NSMakeRect(0, 0, w, h - toolbar_h)
    scroll_view = NSScrollView.alloc().initWithFrame_(scroll_frame)
    scroll_view.setHasVerticalScroller_(True)
    scroll_view.setHasHorizontalScroller_(False)
    scroll_view.setAutoresizingMask_(1 << 1 | 1 << 4)  # NSViewWidthSizable | NSViewHeightSizable

    text_view = NSTextView.alloc().initWithFrame_(NSMakeRect(0, 0, w, h - toolbar_h))
    text_view.setEditable_(False)
    text_view.setSelectable_(True)
    text_view.setRichText_(True)
    text_view.setUsesFontPanel_(False)
    text_view.setAutoresizingMask_(1 << 1)  # NSViewWidthSizable
    text_view.setMinSize_(NSMakeSize(0, h - toolbar_h))
    text_view.setMaxSize_(NSMakeSize(1e7, 1e7))
    text_view.textContainer().setWidthTracksTextView_(True)
    text_view.setVerticallyResizable_(True)
    text_view.setHorizontallyResizable_(False)

    # Dark background
    text_view.setBackgroundColor_(
        NSColor.colorWithCalibratedRed_green_blue_alpha_(0.102, 0.102, 0.18, 1.0)
    )

    scroll_view.setDocumentView_(text_view)
    container.addSubview_(scroll_view)

    return container, text_view, actions


# ─── macOS App Delegate ────────────────────────────────────────────

class AppDelegate(NSObject):

    def applicationDidFinishLaunching_(self, notification):
        self.coordinator = AppCoordinator()
        
        # Start Vite dev server
        self.vite_process = start_vite_server()
        if self.vite_process:
            wait_for_vite_ready()

        screen = NSScreen.mainScreen().frame()
        w, h = 1400, 900
        x = (screen.size.width - w) / 2
        y = (screen.size.height - h) / 2

        style = (NSWindowStyleMaskTitled |
                 NSWindowStyleMaskClosable |
                 NSWindowStyleMaskResizable |
                 NSWindowStyleMaskMiniaturizable)

        self.window = NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(
            NSMakeRect(x, y, w, h), style, NSBackingStoreBuffered, False
        )
        self.window.setTitle_("OpenSpec Desktop")
        self.window.setMinSize_((800, 600))

        # Split view - vertical (top: web app, bottom: log)
        self.outer_split = NSSplitView.alloc().initWithFrame_(NSMakeRect(0, 0, w, h))
        self.outer_split.setVertical_(False)  # horizontal split = top/bottom
        self.outer_split.setDividerStyle_(2)

        # ── Web App WebView (full width, terminal is embedded inside) ──
        config = WKWebViewConfiguration.alloc().init()
        uc = config.userContentController()

        self.bridge_handler = NativeBridgeHandler.alloc().initWithCoordinator_(self.coordinator)
        uc.addScriptMessageHandler_name_(self.bridge_handler, "nativeBridge")
        uc.addScriptMessageHandler_name_(self.bridge_handler, "terminalInput")
        uc.addScriptMessageHandler_name_(self.bridge_handler, "terminalResize")

        # Load last opened directory and saved sessions
        app_config = load_config()
        last_dir = app_config.get('lastDirectory', '')
        last_dir_js = last_dir.replace('\\', '\\\\').replace("'", "\\'")
        
        # Load saved sessions for restoration
        saved_sessions = app_config.get('activeSessions', {'changeTabs': [], 'codexTabs': []})
        saved_sessions_json = json.dumps(saved_sessions, ensure_ascii=False).replace('\\', '\\\\').replace("'", "\\'")

        inject_js = "window.__isNativeApp = true;\n"
        inject_js += "window.__lastDirectory = '" + last_dir_js + "';\n"
        inject_js += "window.__savedSessions = JSON.parse('" + saved_sessions_json + "');\n"
        inject_js += """
        // Request/response tracking
        window.__nativePending = {};
        window.__nativeRequestId = 0;
        
        window.__nativeBridgeResponse = function(response) {
            var id = response.requestId;
            if (window.__nativePending[id]) {
                window.__nativePending[id](response);
                delete window.__nativePending[id];
            }
        };
        
        function nativeRequest(msg) {
            return new Promise(function(resolve) {
                var id = ++window.__nativeRequestId;
                msg.requestId = id;
                window.__nativePending[id] = resolve;
                window.webkit.messageHandlers.nativeBridge.postMessage(JSON.stringify(msg));
            });
        }
        
        window.__nativeBridge = {
            // Terminal commands
            runCommand: function(cmd) {
                window.webkit.messageHandlers.nativeBridge.postMessage(
                    JSON.stringify({type: 'runCommand', command: cmd})
                );
            },
            runCommandWithCallback: function(cmd, callbackId, promptPattern) {
                window.webkit.messageHandlers.nativeBridge.postMessage(
                    JSON.stringify({
                        type: 'runCommandWithCallback',
                        command: cmd,
                        callbackId: callbackId,
                        promptPattern: promptPattern || 'shell'
                    })
                );
            },
            writeInput: function(data) {
                window.webkit.messageHandlers.nativeBridge.postMessage(
                    JSON.stringify({type: 'writeInput', data: data})
                );
            },
            startAgent: function(agentCmd) {
                window.webkit.messageHandlers.nativeBridge.postMessage(
                    JSON.stringify({type: 'startAgent', command: agentCmd})
                );
            },
            
            // File system operations (return Promises)
            pickDirectory: function() {
                return nativeRequest({type: 'fs_pickDirectory'});
            },
            readDirectory: function(path) {
                return nativeRequest({type: 'fs_readDirectory', path: path});
            },
            readFile: function(path) {
                return nativeRequest({type: 'fs_readFile', path: path});
            },
            writeFile: function(path, content) {
                return nativeRequest({type: 'fs_writeFile', path: path, content: content});
            },
            
            // Git operations (return Promises)
            gitStatus: function(path) {
                return nativeRequest({type: 'git_status', path: path});
            },
            gitAdd: function(path, files) {
                return nativeRequest({type: 'git_add', path: path, files: files || ['.']});
            },
            gitCommit: function(path, message) {
                return nativeRequest({type: 'git_commit', path: path, message: message});
            },
            gitLog: function(path, count) {
                return nativeRequest({type: 'git_log', path: path, count: count || 20});
            },
            gitDiff: function(path, opts) {
                opts = opts || {};
                return nativeRequest({type: 'git_diff', path: path, staged: !!opts.staged, file: opts.file || null});
            },
            gitBranch: function(path) {
                return nativeRequest({type: 'git_branch', path: path});
            },
            
            // Review terminal commands
            startReviewTerminal: function(projectPath) {
                window.webkit.messageHandlers.nativeBridge.postMessage(
                    JSON.stringify({type: 'startReviewTerminal', projectPath: projectPath || ''})
                );
            },
            writeReviewInput: function(data) {
                window.webkit.messageHandlers.nativeBridge.postMessage(
                    JSON.stringify({type: 'writeReviewInput', data: data})
                );
            },
            runReviewCommandWithCallback: function(cmd, callbackId, promptPattern) {
                window.webkit.messageHandlers.nativeBridge.postMessage(
                    JSON.stringify({
                        type: 'runReviewCommandWithCallback',
                        command: cmd,
                        callbackId: callbackId,
                        promptPattern: promptPattern || 'shell'
                    })
                );
            },
            stopReviewTerminal: function() {
                window.webkit.messageHandlers.nativeBridge.postMessage(
                    JSON.stringify({type: 'stopReviewTerminal'})
                );
            },
            
            // Change terminal commands (multi-session)
            startChangeTerminal: function(tabId, cols, rows) {
                window.webkit.messageHandlers.nativeBridge.postMessage(
                    JSON.stringify({type: 'startChangeTerminal', tabId: tabId, cols: cols || 80, rows: rows || 24})
                );
            },
            writeChangeInput: function(tabId, data) {
                window.webkit.messageHandlers.nativeBridge.postMessage(
                    JSON.stringify({type: 'writeChangeInput', tabId: tabId, data: data})
                );
            },
            runChangeCommandWithCallback: function(tabId, cmd, callbackId, promptPattern) {
                window.webkit.messageHandlers.nativeBridge.postMessage(
                    JSON.stringify({
                        type: 'runChangeCommandWithCallback',
                        tabId: tabId,
                        command: cmd,
                        callbackId: callbackId,
                        promptPattern: promptPattern || 'shell'
                    })
                );
            },
            stopChangeTerminal: function(tabId) {
                window.webkit.messageHandlers.nativeBridge.postMessage(
                    JSON.stringify({type: 'stopChangeTerminal', tabId: tabId})
                );
            },
            
            // Session tracking for persistence
            trackChangeSession: function(tabId, sessionId, changeId) {
                window.webkit.messageHandlers.nativeBridge.postMessage(
                    JSON.stringify({type: 'trackChangeSession', tabId: tabId, sessionId: sessionId, changeId: changeId || null})
                );
            },
            untrackChangeSession: function(tabId) {
                window.webkit.messageHandlers.nativeBridge.postMessage(
                    JSON.stringify({type: 'untrackChangeSession', tabId: tabId})
                );
            },
            trackCodexSession: function(tabId, sessionId, changeId) {
                window.webkit.messageHandlers.nativeBridge.postMessage(
                    JSON.stringify({type: 'trackCodexSession', tabId: tabId, sessionId: sessionId, changeId: changeId || null})
                );
            },
            untrackCodexSession: function(tabId) {
                window.webkit.messageHandlers.nativeBridge.postMessage(
                    JSON.stringify({type: 'untrackCodexSession', tabId: tabId})
                );
            }
        };
        """
        uc.addUserScript_(WKUserScript.alloc().initWithSource_injectionTime_forMainFrameOnly_(
            inject_js, 0, True
        ))

        self.webview = WKWebView.alloc().initWithFrame_configuration_(
            NSMakeRect(0, 0, w, int(h * 0.75)), config
        )
        self.coordinator.webview = self.webview

        # Set UI delegate for JS alert/confirm/prompt
        self.ui_delegate = WebViewUIDelegate.alloc().init()
        self.webview.setUIDelegate_(self.ui_delegate)

        url = NSURL.URLWithString_("http://localhost:5173")
        self.webview.loadRequest_(NSURLRequest.requestWithURL_(url))

        # ── Bottom: Log Panel (native NSTextView) ──
        log_frame = NSMakeRect(0, 0, w, int(h * 0.25))
        self.log_panel, log_textview, self.log_actions = build_log_panel(self.coordinator, log_frame)
        self.coordinator.log_textview = log_textview

        # Layout - outer split (web app + log)
        self.outer_split.addSubview_(self.webview)
        self.outer_split.addSubview_(self.log_panel)
        self.outer_split.adjustSubviews()
        self.outer_split.setPosition_ofDividerAtIndex_(int(h * 0.75), 0)

        self.window.setContentView_(self.outer_split)
        self.window.makeKeyAndOrderFront_(None)
        NSApplication.sharedApplication().activateIgnoringOtherApps_(True)

        # Start PTY immediately with default size.
        # xterm.js will send a resize once it loads, which will correct the size.
        self.coordinator.start_terminal(80, 24)

        # Start HTTP server for hook notifications
        self.http_server = start_http_server(self.coordinator, port=18888)
        print("App started. Terminal PTY running.")

    def applicationShouldTerminateAfterLastWindowClosed_(self, app):
        return True

    def applicationWillTerminate_(self, notification):
        # Save active worker sessions before terminating
        if hasattr(self, 'coordinator'):
            self._save_active_sessions()
            if self.coordinator.terminal:
                self.coordinator.terminal.kill()
        # Stop Vite dev server
        if hasattr(self, 'vite_process') and self.vite_process:
            print("Stopping Vite dev server...")
            try:
                os.killpg(os.getpgid(self.vite_process.pid), signal.SIGTERM)
            except (ProcessLookupError, OSError):
                pass
            try:
                self.vite_process.terminate()
                self.vite_process.wait(timeout=5)
            except Exception:
                self.vite_process.kill()
            print("Vite dev server stopped.")

    def _save_active_sessions(self):
        """Save active worker sessions to config for restoration on next launch."""
        try:
            config = load_config()
            
            change_tabs = []
            for tab_id, info in self.coordinator.active_change_sessions.items():
                if info.get('sessionId'):
                    change_tabs.append({
                        'sessionId': info['sessionId'],
                        'changeId': info.get('changeId'),
                    })
            
            codex_tabs = []
            for tab_id, info in self.coordinator.active_codex_sessions.items():
                if info.get('sessionId'):
                    codex_tabs.append({
                        'sessionId': info['sessionId'],
                        'changeId': info.get('changeId'),
                    })
            
            config['activeSessions'] = {
                'changeTabs': change_tabs,
                'codexTabs': codex_tabs,
            }
            save_config(config)
            print(f"Active sessions saved: {len(change_tabs)} droid, {len(codex_tabs)} codex")
        except Exception as e:
            print(f"Failed to save active sessions: {e}")


def main():
    app = NSApplication.sharedApplication()
    app.setActivationPolicy_(NSApplicationActivationPolicyRegular)

    # ─── Menu Bar (required for Cmd+C/V/X/A to work in WebView) ───
    menubar = NSMenu.alloc().init()

    # App menu
    app_menu_item = NSMenuItem.alloc().init()
    menubar.addItem_(app_menu_item)
    app_menu = NSMenu.alloc().init()
    app_menu.addItemWithTitle_action_keyEquivalent_("Quit OpenSpec", "terminate:", "q")
    app_menu_item.setSubmenu_(app_menu)

    # Edit menu
    edit_menu_item = NSMenuItem.alloc().init()
    menubar.addItem_(edit_menu_item)
    edit_menu = NSMenu.alloc().initWithTitle_("Edit")
    edit_menu.addItemWithTitle_action_keyEquivalent_("Undo", "undo:", "z")
    edit_menu.addItemWithTitle_action_keyEquivalent_("Redo", "redo:", "Z")
    edit_menu.addItem_(NSMenuItem.separatorItem())
    edit_menu.addItemWithTitle_action_keyEquivalent_("Cut", "cut:", "x")
    edit_menu.addItemWithTitle_action_keyEquivalent_("Copy", "copy:", "c")
    edit_menu.addItemWithTitle_action_keyEquivalent_("Paste", "paste:", "v")
    edit_menu.addItemWithTitle_action_keyEquivalent_("Select All", "selectAll:", "a")
    edit_menu_item.setSubmenu_(edit_menu)

    app.setMainMenu_(menubar)

    delegate = AppDelegate.alloc().init()
    app.setDelegate_(delegate)
    app.activateIgnoringOtherApps_(True)
    app.run()


if __name__ == '__main__':
    main()
