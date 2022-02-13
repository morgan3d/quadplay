#!/usr/bin/env python3

""" Generate the reference .sprite.json for quadplay sprites. """

import argparse
import workjson
import os
import sys

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
        '-g',
        '--game',
        default=detect_default_game(),
        type=str,
        help='Name of the game to add the sprite to.  It not provided, will'
        ' not add to game json.'
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

    grp = parser.add_mutually_exclusive_group(required=True)
    grp.add_argument(
        '-n',
        '--new',
        action="store_true",
        default=False,
        help=(
            'Indicates this is a new sprite to add, rather than an existing '
            'sprite to update.'
        )
    )
    grp.add_argument(
        "-u",
        "--update",
        action="store_true",
        default=False,
        help=(
            "Look in the game's json file and update sprites in this"
            " directory.  Implies --force."
        )
    )

    parser.add_argument(
        "filepath",
        type=str,
        default=None,
        nargs="?",
        help="If specified, only update this file."
    )

    args = parser.parse_args()

    if args.size:
        args.size = {"x": args.size[0], "y": args.size[1]}
    else:
        try:
            import PIL
        except ImportError:
            print("Unable to import PIL.  Consider `pip install pillow`.")
            sys.exit(1)

    return args


# @{ utilities for reading from aseprite data
def _frame(fnum, top_data, size, name):
    """Convert Aseprite pixel coordinate frame to quadplay sprite coord"""

    try:
        print("  {}".format(top_data["frames"][fnum]["filename"]))
        pixel_coordinate = top_data["frames"][fnum]["frame"]
        if name not in top_data["frames"][fnum]["filename"]:
            raise NotImplementedError(
                "Error: tag {} not in filename field {}, can happen when tags"
                "are inside of other tags (not currently supported).".format(
                    name,
                    top_data["frames"][fnum]["filename"]
                )
            )
    except (IndexError, NotImplementedError):
        __import__("ipdb").set_trace()

    return {
        "x": pixel_coordinate["x"]/size["x"],
        "y": pixel_coordinate["y"]/size["y"]
    }


# map "direction" field to "extrapolate" field in quadplay
extrp_map = {
    "forward": "clamp",
    "pingpong": "oscillate",
}


def _frames(ms):
    """convert aseprites frame times in ms to # of 60hz frames"""
    return (ms / 1000.0)*60.0


def _extract_durations(startf, endf, top_data):
    # endf is the last frame inclusive.
    until = endf + 1
    return [
        # durations in aseprite are listed in ms, quadplay wants frames
        _frames(top_data["frames"][i]["duration"])
        for i in range(startf, until)
    ]


def _extract_from_aseprite_json(aseprite_json):
    """Extract aseprite metadata (tags!) from aseprite JSON"""

    with open(aseprite_json) as fi:
        aseprite_data = workjson.loads(fi.read())

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

    size = {"x": width, "y": height}

    name_map = {}
    tag_map = aseprite_data["meta"].get("frameTags", {})
    for tag_data in tag_map:
        name = tag_data["name"]
        print(
            "TAG: {} from {} to {}".format(
                name, tag_data["from"], tag_data["to"]
            )
        )
        name_map[name] = {
            "start": _frame(tag_data["from"], aseprite_data, size, name),
            "end": _frame(tag_data["to"], aseprite_data, size, name),
            "extrapolate": extrp_map.get(tag_data["direction"], "clamp"),
            "frames": _extract_durations(
                tag_data["from"],
                tag_data["to"],
                aseprite_data
            ),
        }

    return size, {"names": name_map, "aseprite_json": aseprite_json}
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

    # if the user specifies size on the commandline, don't change it in the
    # future
    locked_size = size is not None

    extra_data = {}
    if aseprite_json and os.path.exists(aseprite_json):
        print("Using aseprite json file: '{}'".format(aseprite_json))
        ase_size, extra_data = _extract_from_aseprite_json(aseprite_json)

        if not locked_size:
            size = ase_size

    if not size:
        from PIL import Image
        im = Image.open(filepath)
        size = {"x": im.size[0], "y": im.size[1]}

    # read in the base data to preserve attributes that aseprite doesn't
    # preserve, like "pivot".  Hopefully over time Aseprite will allow adding
    # more custom metadata.
    blob = {}
    if os.path.exists(outpath):
        with open(outpath) as fi:
            blob = workjson.loads(fi.read())

    blob.update(
        {
            "url": os.path.relpath(filepath, os.path.dirname(outpath)),
            "sprite_size": size,
            "license": license,
            "locked_size": locked_size,
        }
    )

    # layer in the data from aseprite
    blob.update(extra_data)

    with open(outpath, 'w') as fo:
        fo.write(
            workjson.dumps(
                blob,
                sort_keys=True,
                indent=4, separators=(",", ": ")
            )
        )

    print("wrote: '{}' for sprite '{}'".format(outpath, filepath))

    if not game:
        return

    if not game.endswith(".json"):
        game += ".game.json"

    try:
        with open(game, 'r') as fi:
            game_data = workjson.loads(fi.read())
    except IOError:
        raise RuntimeError(
            "ERROR: no json file for game '{}' found.  Use the -g flag to "
            "pass the the game in.\n".format(game)
        )

    sprite_asset_name = basename + "_sprite"

    game_data.setdefault('assets', {})[sprite_asset_name] = outpath

    with open(game, 'w') as fo:
        fo.write(
            workjson.dumps(
                game_data,
                sort_keys=True,
                indent=4, separators=(",", ": ")
            )
        )
    print("Added '{}' to '{}'".format(sprite_asset_name, game))


def _extract_sprites(from_game):
    with open("{}.game.json".format(from_game)) as fi:
        game_data = workjson.loads(fi.read())

    for asset_url in game_data["assets"].values():
        if not os.path.exists(asset_url):
            continue

        with open(asset_url) as fi:
            asset_data = workjson.loads(fi.read())

        aseprite_data = asset_data.get("aseprite_json")
        dirname = os.path.dirname(asset_url)
        size = None
        if asset_data.get("locked_size"):
            size = asset_data.get("sprite_size")
        if asset_data["url"].endswith(".png"):
            yield (
                os.path.join(dirname, asset_data["url"]),
                aseprite_data,
                size
            )


def main():
    """main function for module"""
    args = parse_args()

    if args.update:
        sprites_to_process = _extract_sprites(args.game)
        args.force = True

        if args.filepath:
            sprites_to_process = [
                (fp, asp, sz) for (fp, asp, sz) in sprites_to_process
                if fp == args.filepath
            ]
    else:
        sprites_to_process = [(args.filepath, args.aseprite, None)]

    for fp, asp_path, size in sprites_to_process:
        print("processing: {}".format(fp))
        make_sprite(
            fp,
            size if size is not None else args.size,
            args.license,
            args.game,
            asp_path,
            args.force
        )


if __name__ == '__main__':
    main()
