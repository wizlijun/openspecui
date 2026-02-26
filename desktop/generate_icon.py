"""Generate macOS app icon (icns) from yinyang_icon.png with Apple HIG drop shadow."""
import os
import shutil
import subprocess
from PIL import Image, ImageFilter

ICON_SIZES = [
    ('icon_16x16.png',      16),
    ('icon_16x16@2x.png',   32),
    ('icon_32x32.png',      32),
    ('icon_32x32@2x.png',   64),
    ('icon_128x128.png',    128),
    ('icon_128x128@2x.png', 256),
    ('icon_256x256.png',    256),
    ('icon_256x256@2x.png', 512),
    ('icon_512x512.png',    512),
    ('icon_512x512@2x.png', 1024),
]

def make_icon(source_img, target_size):
    """Create an icon with Apple HIG-style drop shadow.

    Layout (based on Apple HIG for circular/round icons):
    - ~80% of canvas for the icon content
    - Bottom drop shadow: offset-y ~2-3%, blur ~3-4%, opacity ~30%
    - Small padding at top/sides for the shadow to not clip
    """
    canvas = Image.new('RGBA', (target_size, target_size), (0, 0, 0, 0))

    # Icon occupies ~80% of canvas, shifted slightly up to leave room for shadow below
    icon_size = int(target_size * 0.80)
    if icon_size < 1:
        icon_size = 1

    shadow_offset_y = max(1, int(target_size * 0.025))
    blur_radius = max(1, int(target_size * 0.035))

    # Center horizontally, shift up slightly to accommodate shadow
    x_offset = (target_size - icon_size) // 2
    y_offset = (target_size - icon_size) // 2 - shadow_offset_y // 2

    resized = source_img.resize((icon_size, icon_size), Image.LANCZOS)

    # Create shadow from the alpha channel (fast channel ops, no per-pixel loop)
    shadow = Image.new('RGBA', (target_size, target_size), (0, 0, 0, 0))
    _, _, _, a_ch = resized.split()
    shadow_alpha = a_ch.point(lambda a: int(a * 0.30))
    black = Image.new('L', resized.size, 0)
    shadow_icon = Image.merge('RGBA', (black, black, black, shadow_alpha))
    shadow.paste(shadow_icon, (x_offset, y_offset + shadow_offset_y), shadow_icon)
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=blur_radius))

    # Composite: shadow first, then icon on top
    canvas = Image.alpha_composite(canvas, shadow)
    canvas.paste(resized, (x_offset, y_offset), resized)

    return canvas

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    source_path = os.path.join(script_dir, 'yinyang_icon.png')
    iconset_dir = os.path.join(script_dir, 'YinYangSpec.iconset')
    icns_path = os.path.join(script_dir, 'YinYangSpec.icns')

    if not os.path.exists(source_path):
        print(f'Error: source image not found: {source_path}')
        return

    os.makedirs(iconset_dir, exist_ok=True)
    img = Image.open(source_path).convert('RGBA')

    for filename, pixel_size in ICON_SIZES:
        icon = make_icon(img, pixel_size)
        icon.save(os.path.join(iconset_dir, filename))

    subprocess.run(['iconutil', '-c', 'icns', iconset_dir, '-o', icns_path], check=True)
    print(f'Icon generated: {icns_path}')
    shutil.rmtree(iconset_dir)

if __name__ == '__main__':
    main()
