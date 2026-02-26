#!/usr/bin/env python3
"""
YinYang Spec - macOS native app
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
from autofix_logic import (
    is_codex_turn_complete,
    extract_codex_final_message,
    parse_checkbox_items,
    filter_p0p1_items,
    decide_autofix_next,
)
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

    # macOS PTY input buffer is very small (kern.tty.ptmx_max = 511 bytes).
    # Writing more than this in a single os.write() causes data loss.
    # We chunk writes and use a small delay between chunks to let the PTY drain.
    # CRITICAL: For bracketed paste mode (\x1b[200~ ... \x1b[201~), we must write
    # all chunks rapidly without delay, otherwise the terminal may interpret the
    # pause as end-of-paste and truncate the input.
    _PTY_CHUNK_SIZE = 400  # Increased: closer to 511-byte limit but still safe
    _PTY_CHUNK_DELAY = 0.005  # Reduced to 5ms: fast enough to avoid paste timeout

    def write(self, data: bytes):
        if self.master_fd is not None and self._alive:
            try:
                if len(data) <= self._PTY_CHUNK_SIZE:
                    os.write(self.master_fd, data)
                else:
                    # Large write: chunk it to avoid PTY buffer overflow
                    self._write_chunked(data)
            except OSError:
                pass

    def _write_chunked(self, data: bytes):
        """Write data in small chunks with minimal delays to avoid PTY buffer overflow.
        
        Uses a tight loop with very short delays (5ms) to keep data flowing continuously,
        which is critical for bracketed paste mode where pauses can cause truncation.
        """
        offset = 0
        while offset < len(data) and self._alive:
            end = min(offset + self._PTY_CHUNK_SIZE, len(data))
            chunk = data[offset:end]
            try:
                os.write(self.master_fd, chunk)
            except OSError:
                break
            offset = end
            if offset < len(data):
                time.sleep(self._PTY_CHUNK_DELAY)

    def resize(self, cols: int, rows: int):
        if cols == self.cols and rows == self.rows:
            return
        self.cols = cols
        self.rows = rows
        if self.master_fd is not None and self._alive:
            self._set_size(cols, rows)

    def _kill_descendants(self, pid):
        """Recursively kill all descendant processes of the given PID."""
        import subprocess
        try:
            result = subprocess.run(
                ['pgrep', '-P', str(pid)],
                capture_output=True, text=True, timeout=2
            )
            for child_pid_str in result.stdout.strip().split('\n'):
                if child_pid_str.strip():
                    child_pid = int(child_pid_str.strip())
                    self._kill_descendants(child_pid)  # depth-first: kill grandchildren first
                    try:
                        os.kill(child_pid, signal.SIGTERM)
                        print(f"[TerminalSession] Killed descendant PID={child_pid} of PID={pid}")
                    except (ProcessLookupError, OSError):
                        pass
        except Exception:
            pass

    def kill(self):
        print(f"[TerminalSession] kill() called for PID={self.pid}, alive={self._alive}")
        self._alive = False
        if self.pid:
            # Kill all descendant processes first (depth-first),
            # because child processes like node/codex may create their own process groups
            # and won't be killed by killpg on the shell's group.
            self._kill_descendants(self.pid)
            # Then kill the shell itself
            try:
                os.kill(self.pid, signal.SIGTERM)
                print(f"[TerminalSession] Sent SIGTERM to shell PID={self.pid}")
            except (ProcessLookupError, OSError):
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
                if self.coordinator._review_terminal_ready:
                    # Review terminal already running — immediately fire the shell-ready callback
                    self.coordinator.log('info', 'startReviewTerminal', 'Already running, firing shell-ready immediately')
                    js = "if (window.__onReviewCommandCallback) window.__onReviewCommandCallback('review-shell-ready');"
                    def do_eval():
                        self.coordinator.webview.evaluateJavaScript_completionHandler_(js, None)
                    NSOperationQueue.mainQueue().addOperationWithBlock_(do_eval)
                else:
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
                    'created_at': time.time(),
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

            # Confirmation dialog
            elif msg_type == 'showConfirmationDialog':
                request_id = msg.get('requestId')
                dialog_data = msg.get('data', {})
                self.coordinator.show_confirmation_dialog(str(request_id), dialog_data)

            # Auto Fix window
            elif msg_type == 'openAutoFixWindow':
                change_id = msg.get('changeId', '')
                project_path = msg.get('projectPath', '')
                self.coordinator.open_autofix_window(change_id, project_path)

            # Auto Fix send failure notification
            elif msg_type == 'autoFixSendFailed':
                worker_type = msg.get('workerType', '')
                tab_id = msg.get('tabId', '')
                self.coordinator.log('warn', 'autofix_send_failed', f'worker={worker_type}, tab={tab_id}')
                # Notify all active Auto Fix windows
                for afw in list(self.coordinator._autofix_windows):
                    try:
                        afw.on_send_failed(worker_type, tab_id)
                    except Exception as e:
                        print(f"[AutoFix] Send failure dispatch error: {e}")

            # JS console forwarding
            elif msg_type == 'jsConsole':
                level = msg.get('level', 'log')
                message = msg.get('message', '')
                self.coordinator.log('js', level, message)

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
            panel.setMessage_("Select project directory")
            
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
        """Write file contents. Auto-creates parent directories if needed."""
        request_id = msg.get('requestId')
        path = msg.get('path', '')
        content = msg.get('content', '')
        
        try:
            parent_dir = os.path.dirname(path)
            if parent_dir and not os.path.exists(parent_dir):
                os.makedirs(parent_dir, exist_ok=True)
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
        self._pending_callbacks = {}  # {callback_id: {'pattern': 'shell'|'droid', 'buffer': '', 'created_at': float}}
        self._review_pending_callbacks = {}  # {callback_id: {'pattern': 'shell'|'droid', 'buffer': '', 'created_at': float}}
        self._change_pending_callbacks = {}  # {tab_id: {callback_id: {...}}}
        self._CB_MAX_BUFFER = 512 * 1024  # 512KB max per callback buffer
        self._CB_TIMEOUT_SECS = 300  # 5 min timeout for stale callbacks
        # Track active sessions for persistence
        self.active_change_sessions = {}  # {tab_id: {'sessionId': str, 'changeId': str|None}}
        self.active_codex_sessions = {}  # {tab_id: {'sessionId': str, 'changeId': str|None}}
        # Track active Auto Fix windows
        self._autofix_windows = set()
        self._start_callback_purge_timer()
        # Batched terminal output forwarding to reduce evaluateJavaScript pressure
        self._main_output_batch = bytearray()
        self._main_output_lock = threading.Lock()
        self._main_output_scheduled = False
        self._review_output_batch = bytearray()
        self._review_output_lock = threading.Lock()
        self._review_output_scheduled = False
        self._change_output_batches = {}  # {tab_id: bytearray}
        self._change_output_locks = {}    # {tab_id: Lock}
        self._change_output_scheduled = {}  # {tab_id: bool}
        self._BATCH_INTERVAL = 0.016  # ~60fps

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
            'created_at': time.time(),
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

    def _cap_callback_buffer(self, cb_info):
        """Cap callback buffer to prevent unbounded memory growth.
        Only keeps the tail portion needed for prompt detection."""
        buf = cb_info['buffer']
        if len(buf) > self._CB_MAX_BUFFER:
            cb_info['buffer'] = buf[-self._CB_MAX_BUFFER:]

    def _purge_stale_callbacks(self):
        """Remove callbacks that have been pending longer than _CB_TIMEOUT_SECS."""
        now = time.time()
        timeout = self._CB_TIMEOUT_SECS

        stale = [k for k, v in self._pending_callbacks.items()
                 if now - v.get('created_at', now) > timeout]
        for k in stale:
            self.log('warn', 'purge_stale_callback', f'main: {k}')
            del self._pending_callbacks[k]

        stale = [k for k, v in self._review_pending_callbacks.items()
                 if now - v.get('created_at', now) > timeout]
        for k in stale:
            self.log('warn', 'purge_stale_callback', f'review: {k}')
            del self._review_pending_callbacks[k]

        for tab_id in list(self._change_pending_callbacks):
            cbs = self._change_pending_callbacks[tab_id]
            stale = [k for k, v in cbs.items()
                     if now - v.get('created_at', now) > timeout]
            for k in stale:
                self.log('warn', 'purge_stale_callback', f'change[{tab_id}]: {k}')
                del cbs[k]
            if not cbs:
                del self._change_pending_callbacks[tab_id]

    def _start_callback_purge_timer(self):
        """Start a periodic timer to purge stale callbacks every 60s."""
        def purge_loop():
            while True:
                time.sleep(60)
                try:
                    self._purge_stale_callbacks()
                except Exception as e:
                    print(f"[CallbackPurge] error: {e}")
        t = threading.Thread(target=purge_loop, daemon=True)
        t.start()

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
                self._cap_callback_buffer(cb_info)
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
        with self._main_output_lock:
            self._main_output_batch.extend(data)
            if self._main_output_scheduled:
                return
            self._main_output_scheduled = True

        def flush():
            with self._main_output_lock:
                if not self._main_output_batch:
                    self._main_output_scheduled = False
                    return
                chunk = bytes(self._main_output_batch)
                self._main_output_batch.clear()
                self._main_output_scheduled = False
            b64 = base64.b64encode(chunk).decode('ascii')
            js = f"""
            if (window.__onTerminalOutputBytes) {{
                window.__onTerminalOutputBytes('{b64}');
            }}
            """
            def do_eval():
                self.webview.evaluateJavaScript_completionHandler_(js, None)
            NSOperationQueue.mainQueue().addOperationWithBlock_(do_eval)

        threading.Timer(self._BATCH_INTERVAL, flush).start()

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
            'created_at': time.time(),
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
        """Send review terminal output to the web app (batched)."""
        if not self.webview:
            return

        # Batched forwarding to webview
        with self._review_output_lock:
            self._review_output_batch.extend(data)
            if not self._review_output_scheduled:
                self._review_output_scheduled = True
                def flush_review():
                    with self._review_output_lock:
                        if not self._review_output_batch:
                            self._review_output_scheduled = False
                            return
                        chunk = bytes(self._review_output_batch)
                        self._review_output_batch.clear()
                        self._review_output_scheduled = False
                    b64 = base64.b64encode(chunk).decode('ascii')
                    js = f"""
                    if (window.__onReviewTerminalOutputBytes) {{
                        window.__onReviewTerminalOutputBytes('{b64}');
                    }}
                    """
                    def do_eval():
                        self.webview.evaluateJavaScript_completionHandler_(js, None)
                    NSOperationQueue.mainQueue().addOperationWithBlock_(do_eval)
                threading.Timer(self._BATCH_INTERVAL, flush_review).start()

        # Check pending review callbacks for prompt detection
        if self._review_pending_callbacks:
            try:
                text = data.decode('utf-8', errors='replace')
            except Exception:
                return

            completed = []
            for cb_id, cb_info in self._review_pending_callbacks.items():
                cb_info['buffer'] += text
                self._cap_callback_buffer(cb_info)
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
            'created_at': time.time(),
        }
        self.log('send', 'runChangeCommandWithCallback', f'tab={tab_id}, cmd={command}, cb={callback_id}')
        if tab_id in self.change_terminals:
            self.change_terminals[tab_id].write((command + '\n').encode('utf-8'))

    def stop_change_terminal(self, tab_id: str):
        """Stop a change terminal and release resources."""
        import traceback
        self.log('info', 'stop_change_terminal', f'tab={tab_id}, caller_stack=\n{"".join(traceback.format_stack()[-4:-1])}')
        if tab_id in self.change_terminals:
            terminal = self.change_terminals[tab_id]
            if terminal._alive:
                self.log('info', 'stop_change_terminal', f'tab={tab_id}, killing terminal (pid={terminal.pid})')
                terminal.kill()
            del self.change_terminals[tab_id]
        else:
            self.log('warn', 'stop_change_terminal', f'tab={tab_id}, terminal NOT FOUND')
        if tab_id in self._change_pending_callbacks:
            del self._change_pending_callbacks[tab_id]
        # Clean up batched output state
        self._change_output_batches.pop(tab_id, None)
        self._change_output_locks.pop(tab_id, None)
        self._change_output_scheduled.pop(tab_id, None)

    def resize_change_terminal(self, tab_id: str, cols: int, rows: int):
        """Resize a change terminal."""
        if tab_id in self.change_terminals and self.change_terminals[tab_id]._started:
            self.change_terminals[tab_id].resize(cols, rows)

    def _on_change_terminal_output(self, tab_id: str, data: bytes):
        """Send change terminal output to the web app (batched)."""
        if not self.webview:
            return

        # Batched forwarding to webview
        if tab_id not in self._change_output_locks:
            self._change_output_locks[tab_id] = threading.Lock()
            self._change_output_batches[tab_id] = bytearray()
            self._change_output_scheduled[tab_id] = False

        lock = self._change_output_locks[tab_id]
        with lock:
            self._change_output_batches[tab_id].extend(data)
            if not self._change_output_scheduled.get(tab_id, False):
                self._change_output_scheduled[tab_id] = True
                safe_tab_id = tab_id.replace('\\', '\\\\').replace("'", "\\'")
                def flush_change(tid=tab_id, stid=safe_tab_id):
                    lk = self._change_output_locks.get(tid)
                    if not lk:
                        return
                    with lk:
                        batch = self._change_output_batches.get(tid)
                        if not batch:
                            self._change_output_scheduled[tid] = False
                            return
                        chunk = bytes(batch)
                        batch.clear()
                        self._change_output_scheduled[tid] = False
                    b64 = base64.b64encode(chunk).decode('ascii')
                    js = f"""
                    if (window.__onChangeTerminalOutputBytes && window.__onChangeTerminalOutputBytes['{stid}']) {{
                        window.__onChangeTerminalOutputBytes['{stid}']('{b64}');
                    }}
                    """
                    def do_eval():
                        self.webview.evaluateJavaScript_completionHandler_(js, None)
                    NSOperationQueue.mainQueue().addOperationWithBlock_(do_eval)
                threading.Timer(self._BATCH_INTERVAL, flush_change).start()

        # Check pending callbacks for prompt detection
        if tab_id in self._change_pending_callbacks and self._change_pending_callbacks[tab_id]:
            try:
                text = data.decode('utf-8', errors='replace')
            except Exception:
                return

            completed = []
            for cb_id, cb_info in self._change_pending_callbacks[tab_id].items():
                cb_info['buffer'] += text
                self._cap_callback_buffer(cb_info)
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

    # ─── Confirmation Dialog ────────────────────────────────────────

    def show_confirmation_dialog(self, request_id: str, dialog_data: dict):
        """Create an independent NSWindow with WKWebView for the confirmation dialog."""
        self.log('info', 'showConfirmationDialog', f'requestId={request_id}, items={len(dialog_data.get("items", []))}')

        def do_create():
            try:
                # Window size and position
                screen = NSScreen.mainScreen().frame()
                w, h = 560, 520
                x = (screen.size.width - w) / 2
                y = (screen.size.height - h) / 2

                style = (NSWindowStyleMaskTitled |
                         NSWindowStyleMaskClosable |
                         NSWindowStyleMaskResizable)

                window = NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(
                    NSMakeRect(x, y, w, h), style, NSBackingStoreBuffered, False
                )
                window.setTitle_("确认选择")
                window.setMinSize_((400, 350))

                # WKWebView with message handler
                wk_config = WKWebViewConfiguration.alloc().init()
                uc = wk_config.userContentController()

                handler = ConfirmationDialogHandler.alloc().initWithCoordinator_requestId_(self, request_id)
                handler.dialog_window = window
                uc.addScriptMessageHandler_name_(handler, "confirmationResult")

                # Inject dialog data script BEFORE loading HTML to avoid race condition
                data_json = json.dumps(dialog_data, ensure_ascii=False)
                b64 = base64.b64encode(data_json.encode('utf-8')).decode('ascii')
                inject_js = f"""
                setTimeout(function() {{
                    if (window.initDialog) {{
                        var b = atob('{b64}');
                        var a = new Uint8Array(b.length);
                        for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
                        var text = new TextDecoder('utf-8').decode(a);
                        window.initDialog(text);
                    }}
                }}, 100);
                """
                uc.addUserScript_(WKUserScript.alloc().initWithSource_injectionTime_forMainFrameOnly_(
                    inject_js, 1, True  # injectionTime=1 → AtDocumentEnd
                ))

                webview = WKWebView.alloc().initWithFrame_configuration_(
                    NSMakeRect(0, 0, w, h), wk_config
                )

                # Load the HTML file AFTER scripts are registered
                html_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'confirmation_dialog.html')
                with open(html_path, 'r', encoding='utf-8') as f:
                    html_content = f.read()
                webview.loadHTMLString_baseURL_(html_content, None)

                window.setContentView_(webview)

                # Window delegate to handle close button
                win_delegate = ConfirmationWindowDelegate.alloc().initWithHandler_(handler)
                window.setDelegate_(win_delegate)

                # Keep references alive
                window._confirmation_handler = handler
                window._confirmation_delegate = win_delegate
                window._confirmation_webview = webview

                window.makeKeyAndOrderFront_(None)
                window.setLevel_(3)  # NSFloatingWindowLevel — stay on top

            except Exception as e:
                print(f"show_confirmation_dialog error: {e}")
                self._send_confirmation_response(request_id, {'action': 'cancel'})

        NSOperationQueue.mainQueue().addOperationWithBlock_(do_create)

    def _send_confirmation_response(self, request_id: str, result: dict):
        """Send the confirmation dialog result back to the main webview."""
        if not self.webview:
            return
        payload = json.dumps({'requestId': request_id, **result}, ensure_ascii=False)
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
                console.error('[ConfirmationDialog] Failed to parse response:', e);
            }}
        }}
        """
        def do_eval():
            self.webview.evaluateJavaScript_completionHandler_(js, None)
        NSOperationQueue.mainQueue().addOperationWithBlock_(do_eval)
        self.log('callback', 'confirmation_result', f'requestId={request_id}, action={result.get("action")}')

    def open_autofix_window(self, change_id: str, project_path: str):
        """Open an Auto Fix window for the given change."""
        self.log('info', 'open_autofix_window', f'changeId={change_id}, path={project_path}')
        
        # Generate unique tab IDs for this auto fix session (ms timestamp + random suffix to avoid collision)
        import random
        timestamp_ms = int(time.time() * 1000)
        random_suffix = ''.join(random.choices('0123456789abcdef', k=4))
        codex_tab_id = f'autofix-codex-{change_id or "review"}-{timestamp_ms}-{random_suffix}'
        droid_tab_id = f'autofix-droid-{change_id or "review"}-{timestamp_ms}-{random_suffix}'
        
        # First, notify main webview to create visible Codex and Droid Worker tabs
        if self.webview:
            payload = json.dumps({
                'event': 'create-autofix-workers',
                'codexTabId': codex_tab_id,
                'droidTabId': droid_tab_id,
                'changeId': change_id,
            }, ensure_ascii=False)
            b64 = base64.b64encode(payload.encode('utf-8')).decode('ascii')
            js = f"""
            if (window.__onCreateAutoFixWorkers) {{
                try {{
                    var b = atob('{b64}');
                    var a = new Uint8Array(b.length);
                    for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
                    var text = new TextDecoder('utf-8').decode(a);
                    window.__onCreateAutoFixWorkers(JSON.parse(text));
                }} catch(e) {{ console.error('[AutoFix] create workers error:', e); }}
            }}
            """
            def do_eval():
                self.webview.evaluateJavaScript_completionHandler_(js, None)
            NSOperationQueue.mainQueue().addOperationWithBlock_(do_eval)
        
        # Then create and show the Auto Fix window
        autofix_window = AutoFixWindow(self, codex_tab_id, droid_tab_id, change_id, project_path)
        self._autofix_windows.add(autofix_window)
        autofix_window.show()

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
        
        # Notify active Auto Fix windows about hook events
        for afw in list(self._autofix_windows):
            try:
                afw.on_hook_event(data)
            except Exception as e:
                print(f"[AutoFix] Hook dispatch error: {e}")


# ─── WKUIDelegate for JS alert/confirm/prompt ─────────────────────

# ─── Confirmation Dialog (Independent Window) ─────────────────────

class ConfirmationDialogHandler(NSObject):
    """Handle messages from the confirmation dialog WKWebView."""

    def initWithCoordinator_requestId_(self, coordinator, request_id):
        self = objc.super(ConfirmationDialogHandler, self).init()
        if self is None:
            return None
        self.coordinator = coordinator
        self.request_id = request_id
        self.dialog_window = None
        return self

    def userContentController_didReceiveScriptMessage_(self, controller, message):
        try:
            body = message.body()
            if isinstance(body, str):
                data = json.loads(body)
            elif isinstance(body, dict):
                data = body
            else:
                return

            action = data.get('action', '')
            if action == 'confirm':
                selected_items = data.get('selectedItems', [])
                self._send_result({'action': 'confirm', 'selectedItems': selected_items})
            elif action == 'cancel':
                self._send_result({'action': 'cancel'})
        except Exception as e:
            print(f"ConfirmationDialogHandler error: {e}")
            self._send_result({'action': 'cancel'})

    def _send_result(self, result):
        """Send result back to the main webview and close the dialog window.
        
        Uses _did_send guard to prevent duplicate responses (e.g. close()
        triggering windowWillClose_ after confirm/cancel already sent).
        """
        if getattr(self, '_did_send', False):
            return
        self._did_send = True
        if self.coordinator:
            self.coordinator._send_confirmation_response(self.request_id, result)
        if self.dialog_window:
            def do_close():
                self.dialog_window.close()
            NSOperationQueue.mainQueue().addOperationWithBlock_(do_close)

    def windowWillClose_(self, notification):
        """Handle window close via the X button — treat as cancel."""
        self._send_result({'action': 'cancel'})


class ConfirmationWindowDelegate(NSObject):
    """NSWindowDelegate to detect when the confirmation window is closed."""

    def initWithHandler_(self, handler):
        self = objc.super(ConfirmationWindowDelegate, self).init()
        if self is None:
            return None
        self.handler = handler
        self._did_respond = False
        return self

    def windowWillClose_(self, notification):
        if not self._did_respond and not getattr(self.handler, '_did_send', False):
            self._did_respond = True
            self.handler._send_result({'action': 'cancel'})


# ─── Auto Fix Window (Independent Sidebar Window) ─────────────────

class AutoFixBridgeHandler(NSObject):
    """Handle messages from the Auto Fix window WKWebView."""

    def initWithAutoFixWindow_(self, auto_fix_window):
        self = objc.super(AutoFixBridgeHandler, self).init()
        if self is None:
            return None
        self.auto_fix_window = auto_fix_window
        return self

    def userContentController_didReceiveScriptMessage_(self, controller, message):
        try:
            body = message.body()
            if isinstance(body, str):
                data = json.loads(body)
            elif isinstance(body, dict):
                data = body
            else:
                return

            msg_type = data.get('type', '')
            if msg_type == 'stop':
                self.auto_fix_window.stop()
        except Exception as e:
            print(f"AutoFixBridgeHandler error: {e}")


class AutoFixWindowDelegate(NSObject):
    """NSWindowDelegate to detect when the Auto Fix window is closed."""

    def initWithAutoFixWindow_(self, auto_fix_window):
        self = objc.super(AutoFixWindowDelegate, self).init()
        if self is None:
            return None
        self.auto_fix_window = auto_fix_window
        return self

    def windowWillClose_(self, notification):
        if self.auto_fix_window:
            self.auto_fix_window.stop()
            self.auto_fix_window.cleanup()


class AutoFixWindow:
    """Independent sidebar window that orchestrates the Self-Review Cycle loop.
    
    Flow per cycle:
      1. Init (start Codex + Droid terminals)
      2. Send review prompt to Codex Worker via UI
      3. Parse review result, auto-select all P0/P1 items
      4. Send fix prompt to Droid Worker via UI
      5. Check if P0/P1 remain → if yes, loop back to step 2
    """

    def __init__(self, coordinator, codex_tab_id, droid_tab_id, change_id, project_path):
        self.coordinator = coordinator
        self.codex_tab_id = codex_tab_id
        self.droid_tab_id = droid_tab_id
        self.change_id = change_id
        self.project_path = project_path
        self.window = None
        self.webview = None
        self._running = False
        self._cycle = 0
        self._max_cycles = 10
        self._stage = 'idle'  # idle | init | reviewing | selecting | fixing | checking
        self._codex_session_id = None
        self._droid_session_id = None
        self._codex_initialized = False
        self._droid_initialized = False
        self._stage_timer = None  # Timer for reviewing/fixing stage timeout
        self._stage_timeout_secs = 0  # Disabled: wait indefinitely for review/fix to complete
        # Load confirmation card config (mirrors TS loadConfirmationCardConfig)
        self._scenarios = self._load_scenarios()

    def _load_scenarios(self):
        """Load confirmation card scenarios from YAML config.
        
        Mirrors: app/src/loadConfirmationCardConfig.ts → loadConfirmationCardConfig
        Falls back to a default with [fix_confirmation] trigger if file not found.
        """
        default_scenarios = {
            'review_confirm': {
                'trigger': '[fix_confirmation]',
                'title': '评审结果',
            }
        }
        config_path = os.path.join(self.project_path, '.openspec', 'confirmation_card.yml')
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                import yaml
                parsed = yaml.safe_load(f)
            if not parsed or not isinstance(parsed.get('scenarios'), dict):
                return default_scenarios
            return parsed['scenarios']
        except Exception:
            return default_scenarios

    def show(self):
        """Create and show the Auto Fix sidebar window."""
        def do_create():
            try:
                screen = NSScreen.mainScreen().frame()
                w, h = 380, 700
                # Position on the right side of the screen
                x = screen.size.width - w - 20
                y = (screen.size.height - h) / 2

                style = (NSWindowStyleMaskTitled |
                         NSWindowStyleMaskClosable |
                         NSWindowStyleMaskResizable |
                         NSWindowStyleMaskMiniaturizable)

                self.window = NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(
                    NSMakeRect(x, y, w, h), style, NSBackingStoreBuffered, False
                )
                self.window.setTitle_(f"Self-Review Cycle: {self.change_id or 'Review'}")
                self.window.setMinSize_((320, 500))

                # WKWebView with message handler
                wk_config = WKWebViewConfiguration.alloc().init()
                uc = wk_config.userContentController()

                self._bridge_handler = AutoFixBridgeHandler.alloc().initWithAutoFixWindow_(self)
                uc.addScriptMessageHandler_name_(self._bridge_handler, "autoFixBridge")

                self.webview = WKWebView.alloc().initWithFrame_configuration_(
                    NSMakeRect(0, 0, w, h), wk_config
                )

                # Load HTML
                html_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'auto_fix_window.html')
                with open(html_path, 'r', encoding='utf-8') as f:
                    html_content = f.read()
                self.webview.loadHTMLString_baseURL_(html_content, None)

                self.window.setContentView_(self.webview)

                # Window delegate
                self._win_delegate = AutoFixWindowDelegate.alloc().initWithAutoFixWindow_(self)
                self.window.setDelegate_(self._win_delegate)

                # Keep references alive (on self, not on NSWindow which is KVO-proxied)
                self._ref_handler = self._bridge_handler
                self._ref_delegate = self._win_delegate
                self._ref_webview = self.webview

                self.window.makeKeyAndOrderFront_(None)
                self.window.setLevel_(3)  # NSFloatingWindowLevel

                # Start the loop after a short delay for webview to load
                self._running = True
                threading.Timer(0.5, self._start_loop).start()

            except Exception as e:
                print(f"AutoFixWindow.show error: {e}")

        NSOperationQueue.mainQueue().addOperationWithBlock_(do_create)

    def _eval_js(self, js):
        """Evaluate JavaScript in the Auto Fix webview on the main thread."""
        if not self.webview:
            return
        def do_eval():
            self.webview.evaluateJavaScript_completionHandler_(js, None)
        NSOperationQueue.mainQueue().addOperationWithBlock_(do_eval)

    def _update_step(self, step_num, state, desc=''):
        safe_desc = desc.replace("'", "\\'").replace('\n', ' ')
        self._eval_js(f"window.updateStep({step_num}, '{state}', '{safe_desc}')")

    def _update_cycle(self, count):
        self._eval_js(f"window.updateCycle({count})")

    def _update_status(self, text):
        safe_text = text.replace("'", "\\'").replace('\n', ' ')
        self._eval_js(f"window.updateStatus('{safe_text}')")

    def _session_abbrev(self, session_id: str) -> str:
        """Generate a short abbreviation for a session ID (first 6 chars)."""
        if not session_id:
            return '???'
        return session_id[:6] if len(session_id) >= 6 else session_id

    def _dismiss_confirmation_card(self):
        """Notify main webview to dismiss the confirmation card in the Codex Worker tab."""
        if not self.coordinator.webview:
            return
        payload = json.dumps({
            'event': 'dismiss-confirmation-card',
            'codexTabId': self.codex_tab_id,
        }, ensure_ascii=False)
        b64 = base64.b64encode(payload.encode('utf-8')).decode('ascii')
        js = f"""
        if (window.__onDismissConfirmationCard) {{
            try {{
                var b = atob('{b64}');
                var a = new Uint8Array(b.length);
                for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
                var text = new TextDecoder('utf-8').decode(a);
                window.__onDismissConfirmationCard(JSON.parse(text));
            }} catch(e) {{ console.error('[AutoFix] dismiss card error:', e); }}
        }}
        """
        def do_eval():
            self.coordinator.webview.evaluateJavaScript_completionHandler_(js, None)
        NSOperationQueue.mainQueue().addOperationWithBlock_(do_eval)

    def _start_loop(self):
        """Start the auto fix loop: wait for workers created by main webview to initialize."""
        if not self._running:
            return
        self._eval_js("window.setRunning(true)")
        self._stage = 'init'
        self._update_step(1, 'active', '等待 Codex 和 Droid Worker 初始化...')
        self._update_status('等待 Worker 初始化...')
        
        # Workers are created by the main webview (visible tabs).
        # We wait for hook events (SessionStart for Droid, codex-notify for Codex)
        # to know when they're ready. Set a timeout fallback.
        def init_timeout():
            if not self._running:
                return
            if not self._codex_initialized or not self._droid_initialized:
                missing = []
                if not self._codex_initialized:
                    missing.append('Codex')
                if not self._droid_initialized:
                    missing.append('Droid')
                print(f'[AutoFix] Init timeout — still waiting for: {", ".join(missing)}')
                self._update_step(1, 'error', f'初始化超时：{", ".join(missing)} 未就绪')
                self._update_status(f'初始化超时，请检查 Worker tabs')
                self._complete(False, f'初始化超时：{", ".join(missing)} 未就绪')
        threading.Timer(60.0, init_timeout).start()

    def _check_both_ready(self):
        """Check if both workers are initialized and start first review cycle."""
        if not self._running:
            return
        if self._codex_initialized and self._droid_initialized:
            codex_abbrev = self._session_abbrev(self._codex_session_id or '')
            droid_abbrev = self._session_abbrev(self._droid_session_id or '')
            self._update_step(1, 'completed', f'Codex [{codex_abbrev}] + Droid [{droid_abbrev}] 初始化完成 ✓')
            self._update_status('初始化完成，开始第一轮评审...')
            self._start_review_cycle()

    def _cancel_stage_timer(self):
        """Cancel any active stage timeout timer."""
        if self._stage_timer is not None:
            self._stage_timer.cancel()
            self._stage_timer = None

    def _start_stage_timer(self, stage_label):
        """Start a timeout timer for the current reviewing/fixing stage."""
        self._cancel_stage_timer()
        
        # Skip timer if timeout is 0 (disabled)
        if self._stage_timeout_secs <= 0:
            return
        
        cycle = self._cycle

        def on_timeout():
            if not self._running:
                return
            # Only fire if still in the same stage and cycle
            if self._cycle != cycle:
                return
            if self._stage not in ('reviewing', 'fixing'):
                return
            self.coordinator.log('warn', 'autofix_stage_timeout',
                                 f'stage={self._stage}, cycle={cycle}')
            self._update_step(2 if self._stage == 'reviewing' else 4, 'error',
                              f'{stage_label}超时 ({self._stage_timeout_secs}s)')
            self._complete(False,
                           f'第 {cycle} 轮{stage_label}超时 ({self._stage_timeout_secs}s)，请检查 Worker 状态')

        self._stage_timer = threading.Timer(float(self._stage_timeout_secs), on_timeout)
        self._stage_timer.daemon = True
        self._stage_timer.start()

    def _start_review_cycle(self):
        """Start a new review cycle."""
        if not self._running:
            return
        self._cycle += 1
        self._update_cycle(self._cycle)
        
        if self._cycle > self._max_cycles:
            self._complete(False, f'已达到最大循环次数 ({self._max_cycles})，请手动检查')
            return
        
        self._stage = 'reviewing'
        self._update_step(2, 'active', f'第 {self._cycle} 轮评审中...')
        self._update_status(f'第 {self._cycle} 轮：Codex 正在评审代码...')
        
        # Start stage timeout
        self._start_stage_timer('评审')
        
        # Trigger "Review Again" button click on the Codex Worker tab via frontend
        success = self._trigger_codex_re_review()
        if not success:
            self._cancel_stage_timer()
            self._update_step(2, 'error', '发送评审请求失败')
            self._complete(False, f'第 {self._cycle} 轮发送评审请求失败，请检查 Codex Worker 状态')

    def _trigger_codex_re_review(self):
        """Trigger "Review Again" button click on the Codex Worker tab via frontend.
        
        This calls the frontend's __onAutoFixTriggerReReview bridge, which simulates
        clicking the "Review Again" button configured in codex_worker_define.yml.
        Returns True if trigger was dispatched, False on error.
        """
        if not self._running or not self.coordinator.webview:
            return False
        try:
            payload = json.dumps({
                'tabId': self.codex_tab_id,
            }, ensure_ascii=False)
            b64 = base64.b64encode(payload.encode('utf-8')).decode('ascii')
            # Escape tabId for safe JS string interpolation
            codex_tab_id_escaped = json.dumps(self.codex_tab_id)
            js = f"""
            if (window.__onAutoFixTriggerReReview) {{
                try {{
                    var b = atob('{b64}');
                    var a = new Uint8Array(b.length);
                    for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
                    var text = new TextDecoder('utf-8').decode(a);
                    window.__onAutoFixTriggerReReview(JSON.parse(text));
                }} catch(e) {{
                    console.error('[SelfReviewCycle] trigger re-review error:', e);
                    try {{
                        window.webkit.messageHandlers.nativeBridge.postMessage(
                            JSON.stringify({{type:'autoFixSendFailed', workerType:'codex', tabId:{codex_tab_id_escaped}}})
                        );
                    }} catch(e2) {{}}
                }}
            }} else {{
                console.error('[SelfReviewCycle] __onAutoFixTriggerReReview not registered');
                try {{
                    window.webkit.messageHandlers.nativeBridge.postMessage(
                        JSON.stringify({{type:'autoFixSendFailed', workerType:'codex', tabId:{codex_tab_id_escaped}}})
                    );
                }} catch(e2) {{}}
            }}
            """
            def do_eval():
                self.coordinator.webview.evaluateJavaScript_completionHandler_(js, None)
            NSOperationQueue.mainQueue().addOperationWithBlock_(do_eval)
            return True
        except Exception as e:
            self.coordinator.log('error', 'autofix_trigger_review_failed',
                                 f'tab={self.codex_tab_id}, error={e}')
            return False

    def _trigger_droid_fix(self, items, scenario_key=None):
        """Trigger Droid fix via frontend's handleDroidFixRequest.
        
        This calls the frontend's __onAutoFixDroidFix bridge, which invokes
        handleDroidFixRequest with proper template resolution, Droid Worker
        creation/binding, and message sending.
        Returns True if trigger was dispatched, False on error.
        """
        if not self._running or not self.coordinator.webview:
            return False
        try:
            payload = json.dumps({
                'codexTabId': self.codex_tab_id,
                'droidTabId': self.droid_tab_id,
                'items': items,
                'scenarioKey': scenario_key,
            }, ensure_ascii=False)
            b64 = base64.b64encode(payload.encode('utf-8')).decode('ascii')
            # Escape tabId for safe JS string interpolation
            droid_tab_id_escaped = json.dumps(self.droid_tab_id)
            js = f"""
            if (window.__onAutoFixDroidFix) {{
                try {{
                    var b = atob('{b64}');
                    var a = new Uint8Array(b.length);
                    for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
                    var text = new TextDecoder('utf-8').decode(a);
                    window.__onAutoFixDroidFix(JSON.parse(text));
                }} catch(e) {{
                    console.error('[SelfReviewCycle] trigger droid fix error:', e);
                    try {{
                        window.webkit.messageHandlers.nativeBridge.postMessage(
                            JSON.stringify({{type:'autoFixSendFailed', workerType:'droid', tabId:{droid_tab_id_escaped}}})
                        );
                    }} catch(e2) {{}}
                }}
            }} else {{
                console.error('[SelfReviewCycle] __onAutoFixDroidFix not registered');
                try {{
                    window.webkit.messageHandlers.nativeBridge.postMessage(
                        JSON.stringify({{type:'autoFixSendFailed', workerType:'droid', tabId:{droid_tab_id_escaped}}})
                    );
                }} catch(e2) {{}}
            }}
            """
            def do_eval():
                self.coordinator.webview.evaluateJavaScript_completionHandler_(js, None)
            NSOperationQueue.mainQueue().addOperationWithBlock_(do_eval)
            return True
        except Exception as e:
            self.coordinator.log('error', 'autofix_trigger_droid_fix_failed',
                                 f'codex_tab={self.codex_tab_id}, error={e}')
            return False

    def _extract_session_id(self, data):
        """Extract session_id from hook event data with fallback to payload.thread-id.
        
        Mirrors the logic in on_hook_event to ensure consistent session_id extraction.
        """
        session_id = data.get('session_id', '')
        if not session_id:
            payload = data.get('payload', {})
            if isinstance(payload, dict):
                session_id = payload.get('thread-id') or payload.get('thread_id') or ''
        return session_id

    def _resolve_tab_for_session(self, session_id):
        """Look up which tab_id owns a given session_id.
        
        Checks both active_change_sessions (Droid) and active_codex_sessions (Codex).
        Returns tab_id or None if not yet registered.
        """
        if not session_id:
            return None
        for tab_id, info in self.coordinator.active_change_sessions.items():
            if info.get('sessionId') == session_id:
                return tab_id
        for tab_id, info in self.coordinator.active_codex_sessions.items():
            if info.get('sessionId') == session_id:
                return tab_id
        return None

    def on_send_failed(self, worker_type, tab_id):
        """Called when the JS bridge reports that sendMessage returned false for a worker tab."""
        if not self._running:
            return
        # Only handle failures for our own tabs
        if worker_type == 'codex' and tab_id == self.codex_tab_id:
            self._cancel_stage_timer()
            self.coordinator.log('warn', 'autofix_codex_send_failed',
                                 f'tab={tab_id}, stage={self._stage}, cycle={self._cycle}')
            if self._stage == 'reviewing':
                self._update_step(2, 'error', 'Codex Worker 忙或未就绪，发送失败')
                self._complete(False, f'第 {self._cycle} 轮评审发送失败：Codex Worker 忙或未就绪')
        elif worker_type == 'droid' and tab_id == self.droid_tab_id:
            self._cancel_stage_timer()
            self.coordinator.log('warn', 'autofix_droid_send_failed',
                                 f'tab={tab_id}, stage={self._stage}, cycle={self._cycle}')
            if self._stage == 'fixing':
                self._update_step(4, 'error', 'Droid Worker 忙或未就绪，发送失败')
                self._complete(False, f'第 {self._cycle} 轮修复发送失败：Droid Worker 忙或未就绪')

    def on_hook_event(self, data):
        """Called by coordinator when a hook event arrives that matches our sessions."""
        if not self._running:
            return
        
        event_name = data.get('event', '')
        # Extract session_id with fallback to thread_id from payload (matches TS logic)
        session_id = self._extract_session_id(data)
        
        # Handle Codex events
        if event_name == 'codex-notify':
            if not self._codex_initialized:
                # Init phase: session maps may not be populated yet (frontend
                # processes the same event asynchronously).  Try lookup now;
                # if it fails, queue a deferred retry so the frontend has time
                # to call trackCodexSession.
                matched = self._resolve_tab_for_session(session_id)
                if matched == self.codex_tab_id:
                    self._accept_codex_init(session_id)
                elif matched is not None:
                    # Belongs to a different tab — ignore
                    return
                else:
                    # Not yet in session maps — defer retry
                    self._defer_init_event(data, 'codex')
                return
            
            # After initialization, only accept events from our bound session
            if self._codex_session_id and session_id and session_id != self._codex_session_id:
                return
            
            # Check if codex turn is complete
            if self._is_codex_turn_complete(data):
                final_msg = self._extract_final_message(data)
                if final_msg and self._stage == 'reviewing':
                    self._on_review_complete(final_msg)
        
        elif event_name == 'SessionStart':
            if not self._droid_initialized:
                matched = self._resolve_tab_for_session(session_id)
                if matched == self.droid_tab_id:
                    self._accept_droid_init(session_id)
                elif matched is not None:
                    return
                else:
                    self._defer_init_event(data, 'droid')
                return
            if self._droid_session_id and session_id and session_id != self._droid_session_id:
                return
        
        elif event_name == 'Stop':
            # Droid fix complete — only accept events from our bound droid session
            if session_id and session_id == self._droid_session_id and self._stage == 'fixing':
                result = data.get('last_result', '')
                self._on_fix_complete(result)

    def _accept_codex_init(self, session_id):
        """Bind Codex session and mark initialized."""
        if self._codex_initialized:
            return
        self._codex_initialized = True
        if session_id:
            self._codex_session_id = session_id
        session_abbrev = self._session_abbrev(session_id)
        self._update_step(1, 'active', f'Codex 就绪 [{session_abbrev}] ✓ {"等待 Droid..." if not self._droid_initialized else ""}')
        self.coordinator.log('info', 'autofix_codex_ready', f'tab={self.codex_tab_id}, session={session_id}')
        self._check_both_ready()

    def _accept_droid_init(self, session_id):
        """Bind Droid session and mark initialized."""
        if self._droid_initialized:
            return
        self._droid_initialized = True
        if session_id:
            self._droid_session_id = session_id
        session_abbrev = self._session_abbrev(session_id)
        self._update_step(1, 'active', f'Droid 就绪 [{session_abbrev}] ✓ {"等待 Codex..." if not self._codex_initialized else ""}')
        self.coordinator.log('info', 'autofix_droid_ready', f'tab={self.droid_tab_id}, session={session_id}')
        self._check_both_ready()

    def _defer_init_event(self, data, worker_type, retries_left=5):
        """Retry init event after a short delay to let frontend populate session maps."""
        if not self._running:
            return
        if retries_left <= 0:
            # Exhausted retries — log warning and drop
            session_id = self._extract_session_id(data)
            self.coordinator.log('warn', 'autofix_init_defer_exhausted',
                                 f'worker={worker_type}, session={session_id}, tab={self.codex_tab_id if worker_type == "codex" else self.droid_tab_id}')
            return
        
        def retry():
            if not self._running:
                return
            session_id = self._extract_session_id(data)
            matched = self._resolve_tab_for_session(session_id)
            expected_tab = self.codex_tab_id if worker_type == 'codex' else self.droid_tab_id
            
            if matched == expected_tab:
                if worker_type == 'codex':
                    self._accept_codex_init(session_id)
                else:
                    self._accept_droid_init(session_id)
            elif matched is not None:
                # Belongs to a different tab — ignore
                return
            else:
                # Still not in maps — retry again
                self._defer_init_event(data, worker_type, retries_left - 1)
        
        threading.Timer(0.3, retry).start()

    def _is_codex_turn_complete(self, data):
        """Check if a codex event indicates turn completion.
        
        Delegates to shared autofix_logic module (mirrors TS CodexWorkerBase.tsx).
        """
        return is_codex_turn_complete(data)

    def _extract_final_message(self, data):
        """Extract the final assistant message from a codex event.
        
        Delegates to shared autofix_logic module (mirrors TS CodexWorkerBase.tsx).
        """
        return extract_codex_final_message(data)

    def _on_review_complete(self, review_text):
        """Review result received — use shared decision logic to determine next action.
        
        Delegates to autofix_logic.decide_autofix_next (mirrors TS autoFixStateMachine).
        """
        if not self._running:
            return
        
        self._cancel_stage_timer()
        self._update_step(2, 'completed', f'第 {self._cycle} 轮评审完成 ✓')
        self._stage = 'selecting'
        self._update_step(3, 'active', '正在解析评审结果...')
        
        # Dismiss the confirmation card in the Codex Worker tab
        self._dismiss_confirmation_card()
        
        # Use shared decision logic
        decision = decide_autofix_next(review_text, self._cycle, self._max_cycles, self._scenarios)
        
        if decision['action'] == 'stop':
            reason = decision['reason']
            if reason == 'no_scenario_match':
                self._update_step(3, 'error', '未匹配到任何场景触发标记')
                self._complete(False, f'第 {self._cycle} 轮评审输出未匹配到任何场景触发标记，无法继续')
            elif reason == 'zero_checkboxes':
                self._update_step(3, 'error', '未检测到评审清单格式')
                self._complete(False, f'第 {self._cycle} 轮评审输出格式异常，未找到 checkbox 清单')
            elif reason == 'max_cycles':
                remaining = decision.get('remaining_count', '?')
                self._update_step(3, 'completed', f'仍有 {remaining} 个 P0/P1 问题')
                self._complete(False, f'已达到最大循环次数 ({self._max_cycles})，仍有 {remaining} 个 P0/P1 问题')
            return
        
        if decision['action'] == 'complete':
            self._update_step(3, 'completed', '没有 P0/P1 问题 ✓')
            self._complete(True, f'所有 P0/P1 问题已解决！共 {self._cycle} 轮评审')
            return
        
        # action == 'continue'
        p0p1_items = decision['items']
        scenario_key = decision.get('scenario_key')
        self._update_step(3, 'completed', f'选中 {len(p0p1_items)} 个 P0/P1 问题 ✓')
        self._update_status(f'第 {self._cycle} 轮：发送 {len(p0p1_items)} 个问题给 Droid 修复...')
        
        # Send fix request to Droid
        self._stage = 'fixing'
        self._update_step(4, 'active', f'Droid 正在修复 {len(p0p1_items)} 个问题...')
        
        # Start stage timeout for fixing
        self._start_stage_timer('修复')
        
        # Trigger Droid fix via frontend (which handles template resolution, Droid Worker creation, etc.)
        # Small delay to let UI update
        def do_fix():
            success = self._trigger_droid_fix(p0p1_items, scenario_key)
            if not success:
                self._cancel_stage_timer()
                self._update_step(4, 'error', '发送修复请求失败')
                self._complete(False, f'第 {self._cycle} 轮发送修复请求失败，请检查 Droid Worker 状态')
        threading.Timer(0.3, do_fix).start()

    def _on_fix_complete(self, result_text):
        """Droid fix complete — check results."""
        if not self._running:
            return
        
        self._cancel_stage_timer()
        self._update_step(4, 'completed', f'第 {self._cycle} 轮修复完成 ✓')
        self._stage = 'checking'
        self._update_step(5, 'active', '检查修复结果...')
        self._update_status(f'第 {self._cycle} 轮修复完成，准备下一轮评审...')
        
        # Mark step 5 as completed and start next cycle
        self._update_step(5, 'completed', '准备下一轮 ✓')
        
        # Reset steps 2-5 for next cycle after a brief pause
        def next_cycle():
            if not self._running:
                return
            for i in range(2, 6):
                self._eval_js(f"""
                    (function() {{
                        var step = document.getElementById('step{i}');
                        step.className = 'step';
                        var icons = ['⏳', '🔍', '✅', '🔧', '🔄'];
                        step.querySelector('.step-icon').textContent = icons[{i-1}];
                    }})()
                """)
            self._start_review_cycle()
        
        threading.Timer(1.0, next_cycle).start()

    def _complete(self, success, message):
        """Mark the auto fix loop as complete."""
        self._cancel_stage_timer()
        self._running = False
        self._stage = 'idle'
        safe_msg = message.replace("'", "\\'")
        self._eval_js(f"window.complete({'true' if success else 'false'}, '{safe_msg}')")
        self.coordinator.log('info', 'autofix_complete', f'success={success}, msg={message}')
        
        # Notify main webview
        if self.coordinator.webview:
            payload = json.dumps({
                'event': 'autofix-complete',
                'success': success,
                'message': message,
                'cycles': self._cycle,
                'changeId': self.change_id,
            }, ensure_ascii=False)
            b64 = base64.b64encode(payload.encode('utf-8')).decode('ascii')
            js = f"""
            if (window.__onAutoFixComplete) {{
                try {{
                    var b = atob('{b64}');
                    var a = new Uint8Array(b.length);
                    for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
                    var text = new TextDecoder('utf-8').decode(a);
                    window.__onAutoFixComplete(JSON.parse(text));
                }} catch(e) {{ console.error('[AutoFix] parse error:', e); }}
            }}
            """
            def do_eval():
                self.coordinator.webview.evaluateJavaScript_completionHandler_(js, None)
            NSOperationQueue.mainQueue().addOperationWithBlock_(do_eval)

    def stop(self):
        """Stop the auto fix loop."""
        if not self._running:
            return
        self._cancel_stage_timer()
        self._running = False
        self._stage = 'idle'
        self._update_status('已手动停止')
        self._eval_js("window.setRunning(false)")
        self.coordinator.log('info', 'autofix_stopped', f'cycle={self._cycle}')

    def cleanup(self):
        """Clean up when window is closed."""
        self._cancel_stage_timer()
        self._running = False
        # Don't kill terminals — they're visible tabs managed by the main webview.
        # User can close them manually if needed.
        # Remove from coordinator's active autofix windows
        if hasattr(self.coordinator, '_autofix_windows'):
            self.coordinator._autofix_windows.discard(self)


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
    """Build the native log panel: NSScrollView + NSTextView.
    Returns (container_view, text_view, actions_delegate).
    """
    w = frame.size.width
    h = frame.size.height

    container = NSView.alloc().initWithFrame_(frame)

    # Actions delegate (kept for API compatibility)
    actions = LogPanelActions.alloc().initWithCoordinator_(coordinator)

    # ── Scroll View + Text View ──
    scroll_frame = NSMakeRect(0, 0, w, h)
    scroll_view = NSScrollView.alloc().initWithFrame_(scroll_frame)
    scroll_view.setHasVerticalScroller_(True)
    scroll_view.setHasHorizontalScroller_(False)
    scroll_view.setAutoresizingMask_(1 << 1 | 1 << 4)  # NSViewWidthSizable | NSViewHeightSizable

    text_view = NSTextView.alloc().initWithFrame_(NSMakeRect(0, 0, w, h))
    text_view.setEditable_(False)
    text_view.setSelectable_(True)
    text_view.setRichText_(True)
    text_view.setUsesFontPanel_(False)
    text_view.setAutoresizingMask_(1 << 1)  # NSViewWidthSizable
    text_view.setMinSize_(NSMakeSize(0, h))
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
        # Restore log panel visibility from last session (default: visible)
        app_config_init = load_config()
        self.log_visible = app_config_init.get('logPanelVisible', True)
        
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
        self.window.setTitle_("YinYang Spec")
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
        // Console log interceptor — forward JS logs to native log panel
        (function() {
            var origLog = console.log, origWarn = console.warn, origError = console.error;
            function forward(level, args) {
                try {
                    var msg = Array.prototype.map.call(args, function(a) {
                        if (a instanceof Error) return a.message + '\\n' + a.stack;
                        if (typeof a === 'object') try { return JSON.stringify(a); } catch(e) { return String(a); }
                        return String(a);
                    }).join(' ');
                    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.nativeBridge) {
                        window.webkit.messageHandlers.nativeBridge.postMessage(
                            JSON.stringify({type: 'jsConsole', level: level, message: msg.substring(0, 2000)})
                        );
                    }
                } catch(e) {}
            }
            console.log = function() { forward('log', arguments); origLog.apply(console, arguments); };
            console.warn = function() { forward('warn', arguments); origWarn.apply(console, arguments); };
            console.error = function() { forward('error', arguments); origError.apply(console, arguments); };
        })();

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
            },
            
            // Confirmation dialog (opens independent native window, returns Promise)
            showConfirmationDialog: function(data) {
                return nativeRequest({type: 'showConfirmationDialog', data: data});
            },
            
            // Auto Fix window (opens independent sidebar window)
            openAutoFixWindow: function(changeId, projectPath) {
                window.webkit.messageHandlers.nativeBridge.postMessage(
                    JSON.stringify({type: 'openAutoFixWindow', changeId: changeId, projectPath: projectPath})
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

        # Apply saved log panel visibility state
        if not self.log_visible:
            self.log_panel.setHidden_(True)
            self.outer_split.adjustSubviews()
            # Update menu item title to match
            if hasattr(self, 'log_toggle_menu_item') and self.log_toggle_menu_item:
                self.log_toggle_menu_item.setTitle_("Show Log")

        self.window.setContentView_(self.outer_split)
        self.window.makeKeyAndOrderFront_(None)
        NSApplication.sharedApplication().activateIgnoringOtherApps_(True)

        # Start PTY immediately with default size.
        # xterm.js will send a resize once it loads, which will correct the size.
        self.coordinator.start_terminal(80, 24)

        # Start HTTP server for hook notifications
        self.http_server = start_http_server(self.coordinator, port=18888)
        print("App started. Terminal PTY running.")

    def toggleLogPanel_(self, sender):
        """Toggle log panel visibility."""
        if self.log_visible:
            # Hide log panel
            self.log_panel.setHidden_(True)
            self.outer_split.adjustSubviews()
            self.log_visible = False
            sender.setTitle_("Show Log")
        else:
            # Show log panel
            self.log_panel.setHidden_(False)
            # Restore split position
            h = self.window.frame().size.height
            self.outer_split.setPosition_ofDividerAtIndex_(int(h * 0.75), 0)
            self.outer_split.adjustSubviews()
            self.log_visible = True
            sender.setTitle_("Hide Log")
        # Persist visibility state
        config = load_config()
        config['logPanelVisible'] = self.log_visible
        save_config(config)

    def showAbout_(self, sender):
        """Show About panel with large app icon."""
        from AppKit import NSImage, NSImageView, NSTextField
        from Cocoa import NSPanel, NSMakeRect, NSWindowStyleMaskTitled, NSWindowStyleMaskClosable, NSBackingStoreBuffered, NSFont, NSColor, NSView

        panel_w, panel_h = 360, 320
        screen = NSScreen.mainScreen().frame()
        px = (screen.size.width - panel_w) / 2
        py = (screen.size.height - panel_h) / 2

        panel = NSPanel.alloc().initWithContentRect_styleMask_backing_defer_(
            NSMakeRect(px, py, panel_w, panel_h),
            NSWindowStyleMaskTitled | NSWindowStyleMaskClosable,
            NSBackingStoreBuffered, False
        )
        panel.setTitle_("About YinYang Spec")

        content = NSView.alloc().initWithFrame_(NSMakeRect(0, 0, panel_w, panel_h))

        # App icon (128x128) from yinyang_icon.png
        icon_size = 128
        icon_x = (panel_w - icon_size) / 2
        icon_view = NSImageView.alloc().initWithFrame_(NSMakeRect(icon_x, panel_h - icon_size - 30, icon_size, icon_size))
        icon_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'yinyang_icon.png')
        if os.path.exists(icon_path):
            icon_img = NSImage.alloc().initWithContentsOfFile_(icon_path)
            icon_view.setImage_(icon_img)
        content.addSubview_(icon_view)

        # App name
        name_label = NSTextField.alloc().initWithFrame_(NSMakeRect(0, panel_h - icon_size - 70, panel_w, 28))
        name_label.setStringValue_("YinYang Spec")
        name_label.setFont_(NSFont.boldSystemFontOfSize_(18))
        name_label.setAlignment_(1)  # center
        name_label.setBezeled_(False)
        name_label.setDrawsBackground_(False)
        name_label.setEditable_(False)
        name_label.setSelectable_(False)
        content.addSubview_(name_label)

        # Subtitle
        sub_label = NSTextField.alloc().initWithFrame_(NSMakeRect(0, panel_h - icon_size - 95, panel_w, 20))
        sub_label.setStringValue_("The AI Coding IDE")
        sub_label.setFont_(NSFont.systemFontOfSize_(13))
        sub_label.setTextColor_(NSColor.secondaryLabelColor())
        sub_label.setAlignment_(1)
        sub_label.setBezeled_(False)
        sub_label.setDrawsBackground_(False)
        sub_label.setEditable_(False)
        sub_label.setSelectable_(False)
        content.addSubview_(sub_label)

        # Version
        ver_label = NSTextField.alloc().initWithFrame_(NSMakeRect(0, panel_h - icon_size - 120, panel_w, 20))
        ver_label.setStringValue_("Version 1.0.0")
        ver_label.setFont_(NSFont.systemFontOfSize_(11))
        ver_label.setTextColor_(NSColor.tertiaryLabelColor())
        ver_label.setAlignment_(1)
        ver_label.setBezeled_(False)
        ver_label.setDrawsBackground_(False)
        ver_label.setEditable_(False)
        ver_label.setSelectable_(False)
        content.addSubview_(ver_label)

        panel.setContentView_(content)
        panel.makeKeyAndOrderFront_(None)
        # Retain panel to prevent deallocation
        if not hasattr(self, '_about_panel'):
            self._about_panel = None
        self._about_panel = panel

    def applicationShouldTerminateAfterLastWindowClosed_(self, app):
        return True

    def applicationWillTerminate_(self, notification):
        # Save active worker sessions before terminating
        if hasattr(self, 'coordinator'):
            self._save_active_sessions()
            # Kill all change terminals
            for tab_id in list(self.coordinator.change_terminals.keys()):
                self.coordinator.stop_change_terminal(tab_id)
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
    # Set process name and bundle name so macOS menu bar shows "YinYang Spec" instead of "Python"
    from Foundation import NSProcessInfo, NSBundle
    NSProcessInfo.processInfo().setProcessName_("YinYang Spec")
    bundle = NSBundle.mainBundle()
    info = bundle.localizedInfoDictionary() or bundle.infoDictionary()
    if info:
        info['CFBundleName'] = 'YinYang Spec'

    app = NSApplication.sharedApplication()
    app.setActivationPolicy_(NSApplicationActivationPolicyRegular)

    # Set application icon
    icon_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'YinYangSpec.icns')
    if os.path.exists(icon_path):
        from AppKit import NSImage
        icon = NSImage.alloc().initWithContentsOfFile_(icon_path)
        app.setApplicationIconImage_(icon)

    # ─── Menu Bar (required for Cmd+C/V/X/A to work in WebView) ───
    menubar = NSMenu.alloc().init()

    # App menu
    app_menu_item = NSMenuItem.alloc().init()
    menubar.addItem_(app_menu_item)
    app_menu = NSMenu.alloc().initWithTitle_("YinYang Spec")
    app_menu.addItemWithTitle_action_keyEquivalent_("About", "showAbout:", "")
    app_menu.addItem_(NSMenuItem.separatorItem())
    app_menu.addItemWithTitle_action_keyEquivalent_("Quit", "terminate:", "q")
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

    # View menu (for log panel toggle)
    view_menu_item = NSMenuItem.alloc().init()
    menubar.addItem_(view_menu_item)
    view_menu = NSMenu.alloc().initWithTitle_("View")
    log_toggle_item = view_menu.addItemWithTitle_action_keyEquivalent_("Hide Log", "toggleLogPanel:", "l")
    view_menu_item.setSubmenu_(view_menu)

    app.setMainMenu_(menubar)

    delegate = AppDelegate.alloc().init()
    delegate.log_toggle_menu_item = log_toggle_item
    app.setDelegate_(delegate)
    app.activateIgnoringOtherApps_(True)
    app.run()


if __name__ == '__main__':
    main()
