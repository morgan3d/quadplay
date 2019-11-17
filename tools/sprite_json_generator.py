#!/usr/bin/env python

""" Generate the reference .sprite.json for quadplay sprites. """

import argparse
import json
import os

# `pip install pillow`
from PIL import Image

# @TODO: Add a requirements.txt or such to make setting up the virtualenv easy.

def detect_default_game():
    """try and detect based on the current directory"""

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
    parser.add_argument(
        "-a",
        "--aseprite",
        type=str,
        default=None,
        help=(
            "Specify the location of aseprite json file.  If exporting from "
            "aseprite, see the manual section for more detail on the best way"
            " to export sprites for quadplay from aseprite."
        )
    )

    return parser.parse_args()


# @{ utilities for reading from aseprite data
def _frame(fnum, top_data, size):
    """Convert Aseprite pixel coordinate frame to quadplay sprite coord"""

    pixel_coordinate = top_data["frames"][fnum]["frame"]

    return {
        "x": pixel_coordinate["x"]/size[0],
        "y": pixel_coordinate["y"]/size[1]
    }

# map "direction" field to "extrapolate" field in quadplay
extrp_map = {
    "forward" : "clamp",
    "pingpong": "oscillate",
}

def _extract_from_aseprite_json(aseprite_json):
    """Extract aseprite metadata (tags!) from aseprite JSON"""

    with open(aseprite_json) as fi:
        aseprite_data = json.loads(fi.read())

    # sentinel to detect the format of the json
    if "aseprite" not in aseprite_data.get("meta", {}).get("app", ""):
        raise NotImplementedError(
            "Error: tried to read aseprite data from {}, but is not in "
            "an aseprite json format this script understands."
        )

    # figure out the sprite dimension
    width = None
    height = None

    # @TODO: detect when files are written in "hash" mode instead of array
    #        mode

    # ensure that there is only one size of sprite in the file
    for frame_data in aseprite_data["frames"]:
        try:
            this_width = frame_data["frame"].get("w")
        except TypeError as e:
            raise RuntimeError(
                "JSON format was not as expected for aseprite json files."
                "  This tool only understands files exported in 'ARRAY' mode, "
                "not 'HASH' mode from aseprite.  Aseprite file: '{}', "
                "error: '{}'".format(aseprite_json, e)
            )
        this_height = frame_data["frame"].get("h")
        width = width or this_width
        height = height or this_height
        if (width, height) != (this_width, this_height):
            raise NotImplementedError(
                "Quadplay doesn't support variable size sprites. "
                "found: {} and {}".format(
                    (this_width, this_height),
                    (width, height)
                )
            )

    size = (width, height)

    name_map = {}
    tag_map = aseprite_data["meta"].get("frameTags", {})
    for tag_data in tag_map:
        name_map[tag_data["name"]] = {
            "start" : _frame(tag_data["from"], aseprite_data, size),
            "end" : _frame(tag_data["to"], aseprite_data, size),
            "extrapolate": extrp_map[tag_data["direction"]]
        }

    return size, {"names": name_map}
# @}


def make_sprite(
        filepath,
        size,
        license,
        game,
        aseprite_json=None,
        force=False
):
    """take a file and build a quadplay sprite JSON"""

    # quadplay requires the .sprite.json
    basename, suffix = os.path.splitext(os.path.basename(filepath))
    outpath = os.path.splitext(filepath)[0] + ".sprite.json"

    if suffix.lower() not in (".png"):
        raise NotImplementedError(
            "Quadplay only supports png sprite sheets at the moment, "
            "got filepath: '{}' with suffix: '{}'".format(filepath, suffix)
        )

    if os.path.exists(outpath) and not force:
        raise RuntimeError(
            "File '{}' already exists, to overwrite existing file, use "
            "'--force' argument.".format(outpath)
        )

    extra_data = {}
    if aseprite_json and os.path.exists(aseprite_json):
        print("Using aseprite json file: '{}'".format(aseprite_json))
        size, extra_data = _extract_from_aseprite_json(aseprite_json)

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

    # layer in the data from aseprite
    blob.update(extra_data)

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

    make_sprite(
        args.filepath,
        args.size,
        args.license,
        args.game,
        args.aseprite,
        args.force
    )

if __name__ == '__main__':
    main()
