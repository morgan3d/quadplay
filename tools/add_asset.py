#!/usr/bin/env python

""" Add assets to a quadplay game from the commandline. """

import argparse
import workjson
import os
import sys

import quad_utils


def parse_args():
    """ parse arguments out of sys.argv """

    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )
    # parser.add_argument(
    #     "-f",
    #     "--force",
    #     action="store_true",
    #     default=False,
    #     help="Overwrite any existing files."
    # )
    # parser.add_argument(
    #     "-s",
    #     "--size",
    #     default=None,
    #     nargs=2,
    #     type=int,
    #     help="Set the size of sprite in the sprite sheet.  If not set, will "
    #     "assume a full image sprite."
    # )
    # parser.add_argument(
    #     '-l',
    #     '--license',
    #     type=str,
    #     default="None",
    #     help="Pick a standard license."
    # )
    parser.add_argument(
        '-g',
        '--game',
        default=quad_utils.detect_default_game(),
        type=str,
        help='Name of the game to add the sprite to.  It not provided, will'
        ' not add to game json.'
    )
    # parser.add_argument(
    #     "-a",
    #     "--aseprite",
    #     type=str,
    #     default=None,
    #     help=(
    #         "Specify the location of aseprite json file.  If exporting from "
    #         "aseprite, see the manual section for more detail on the best way"
    #         " to export sprites for quadplay from aseprite."
    #     )
    # )

    # grp = parser.add_mutually_exclusive_group(required=True)
    # grp.add_argument(
    #     '-n',
    #     '--new',
    #     action="store_true",
    #     default=False,
    #     help=(
    #         'Indicates this is a new sprite to add, rather than an existing '
    #         'sprite to update.'
    #     )
    # )
    # grp.add_argument(
    #     "-u",
    #     "--update",
    #     action="store_true",
    #     default=False,
    #     help=(
    #         "Look in the game's json file and update sprites in this"
    #         " directory.  Implies --force."
    #     )
    # )

    parser.add_argument(
        "filepath",
        type=str,
        default=None,
        nargs="+",
        help="If specified, only update this file."
    )

    args = parser.parse_args()

    return args


ASSET_KIND_MAP = {
    "yml": "raw",
}


def main():
    """main function for module"""
    args = parse_args()

    game_data = quad_utils.load_game_json(args.game)

    for fp in args.filepath:
        suffix = os.path.splitext(fp)[1][1:]
        asset_kind = ASSET_KIND_MAP[suffix]
        name = os.path.splitext(os.path.basename(fp))[0].upper()
        print(f"adding {fp} as asset {name} of kind {asset_kind}")

        if name in game_data["constants"]:
            raise RuntimeError(
                f"Asset named {name} already present in {args.game}"
            )

        game_data["constants"][name] = {
            "type": asset_kind,
            "url": fp,
        }

    quad_utils.write_game_json(args.game, game_data)
    print(f"Added {len(args.filepath)} new assets")


if __name__ == '__main__':
    main()
