#!/usr/bin/env python

""" Generate the reference .sprite.json for quadplay sprites. """

import argparse
import json
import os

# `pip install pillow`
from PIL import Image

# @TODO: Automatically add it to the game.json?
# @TODO: Add a requirements.txt or such to make setting up the virtualenv easy.

def detect_default_game():
    """
    try and detect based on the current directory
    """
    return os.path.basename(os.getcwd())

def parse_args():
    """ parse arguments out of sys.argv """
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )
    parser.add_argument(
        "-f",
        "--force",
        action="store_true",
        default=False,
        help="Overwrite any existing files."
    )
    parser.add_argument(
        "-s",
        "--size",
        default=None,
        nargs=2,
        type=int,
        help="Set the size of sprite in the sprite sheet.  If not set, will "
        "assume a full image sprite."
    )
    parser.add_argument(
        '-l',
        '--license',
        type=str,
        default="None",
        help="Pick a standard license."
    )
    parser.add_argument(
        'filepath',
        type=str,
        help='URLs to sprite images'
    )
    parser.add_argument(
        '-g',
        '--game',
        default=detect_default_game(),
        type=str,
        help='Name of the game to add the sprite to.  It not provided, will not'
        ' add to game json.'
    )
    return parser.parse_args()

def make_sprite(filepath, size, license, game, force=False):
    # quadplay requires the .sprite.json
    basename = os.path.basename(os.path.splitext(filepath)[0])
    outpath = os.path.splitext(filepath)[0] + ".sprite.json"


    if os.path.exists(outpath) and not force:
        raise RuntimeError(
            "File '{}' already exists, to overwrite existing file, use "
            "'--force' argument.".format(outpath)
        )

    if not size:
        im = Image.open(filepath)
        size = im.size
    else:
        size = (size[0], size[1])

    blob = {
        "url" : filepath,
        "spriteSize" : {'x':size[0],'y':size[1]},
        "license" : license
    }

    with open(outpath, 'w') as fo:
        fo.write(
            json.dumps(
                blob,
                sort_keys=True,
                indent=4, separators=(",",": ")
            )
        )

    print("wrote: '{}' for sprite '{}'".format(outpath, filepath))

    if not game:
        return

    if not game.endswith(".json"):
        game += ".game.json"

    try:
        with open(game, 'r') as fi:
            game_data = json.loads(fi.read())
    except IOError:
        raise RuntimeError(
            "ERROR: no json file for game '{}' found.  Use the -g flag to "
            "pass the the game in.\n".format(game)
        )

    game_data.setdefault('assets',{})[basename + "Sprite"] = outpath

    with open(game, 'w') as fo:
        fo.write(
            json.dumps(
                game_data,
                sort_keys=True,
                indent=4, separators=(",",": ")
            )
        )
    print("Added '{}' to '{}'".format(basename + "Sprite", game))

def main():
    """main function for module"""
    args = parse_args()
    make_sprite(args.filepath, args.size, args.license, args.game, args.force)

if __name__ == '__main__':
    main()
