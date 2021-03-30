#!/usr/bin/env python3

import argparse
import os
import json


# @TODO: this is from the sprite_json_generator -- these scripts should be
#        collapsed
def detect_default_game():
    """try and detect based on the current directory"""

    return os.path.basename(os.getcwd())


def _stringify_json(blob_dict):
    return json.dumps(
        blob_dict,
        sort_keys=False,
        indent=4, separators=(",", ": ")
    )


def parse_args():
    """ parse arguments out of sys.argv """
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )
    parser.add_argument(
        "-d",
        "--dryrun",
        action="store_true",
        default=False,
        help="dryrun mode - print what *would* be done"
    )
    parser.add_argument(
        "-f",
        "--force",
        action="store_true",
        default=False,
        help="Overwrite existing files"
    )
    parser.add_argument(
        'filepath',
        type=str,
        nargs='+',
        help='Files that do stuff'
    )
    parser.add_argument(
        '-g',
        '--game',
        default=detect_default_game(),
        type=str,
        help='Name of the game to add the sprite to.  It not provided, will'
        ' not add to game json.'
    )
    return parser.parse_args()


def _add_sound(snd_path, dryrun=False, force=False):
    basename, ext = os.path.splitext(snd_path)
    dirname = os.path.dirname(basename)
    basename = os.path.basename(basename)
    json_name = os.path.join(dirname, "{}.sound.json".format(basename))

    if os.path.exists(json_name) and not force:
        raise RuntimeError(
            "Json file already exists, use --force to overwrite."
        )

    result = {
        "url": "{}{}".format(basename, ext)
    }

    json_text = _stringify_json(result)

    if dryrun:
        print(
            "Would have created: {} which would contain:\n{}".format(
                json_name,
                json_text
            )
        )
        return

    with open(json_name, 'w') as fo:
        fo.write(json_text)

    print("created: {}".format(json_text))

    return basename, json_name


def _add_sound_to_game(sound_asset_name, sound_asset_path, game_json):
    game_json["assets"][sound_asset_name + "_snd"] = sound_asset_path


def main():
    """main function for module"""
    args = parse_args()

    game_json_path = "{}.game.json".format(args.game)
    if not os.path.exists(game_json_path):
        raise RuntimeError(
            "{} does not exist, run from same directory as {}, or set --game"
            "".format(
                game_json_path
            )
        )

    with open(game_json_path, 'r') as fi:
        game_json = json.loads(fi.read())

    for snd_path in args.filepath:
        sound_asset_name, sound_json_path = _add_sound(
            snd_path,
            args.dryrun,
            args.force
        )

        _add_sound_to_game(sound_asset_name, sound_json_path, game_json)

    if args.dryrun:
        print("Would have updated {}".format(game_json_path))
        return

    with open(game_json_path, 'w') as fo:
        fo.write(_stringify_json(game_json))


if __name__ == '__main__':
    main()
