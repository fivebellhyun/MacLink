"""Render the existing MacLink favicon geometry into a macOS icon."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw


def create_icon(destination):
    scale = 16
    image = Image.new('RGBA', (64 * scale, 64 * scale))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, 64 * scale - 1, 64 * scale - 1), 16 * scale, fill='#246950')
    points = [(17, 42), (17, 23), (32, 35), (47, 23), (47, 42)]
    roof = [(17, 23), (32, 14), (47, 23)]
    for line in (points, roof):
        draw.line([(x * scale, y * scale) for x, y in line], fill='white', width=5 * scale, joint='curve')
        for x, y in line:
            radius = 2.5 * scale
            draw.ellipse((x * scale - radius, y * scale - radius, x * scale + radius, y * scale + radius), fill='white')
    image.save(destination, format='ICNS')


if __name__ == '__main__':
    create_icon(Path(sys.argv[1]))
