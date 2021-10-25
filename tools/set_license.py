#!/usr/bin/env python

import argparse
import workjson


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
        'filepath',
        type=str,
        nargs='+',
        help='Files that do stuff'
    )
    parser.add_argument(
        '-l',
        '--license',
        type=str,
        required=True,
        help="License to assign in each .json file.",
    )
    return parser.parse_args()


def main():
    """main function for module"""
    args = parse_args()

    print("Modifying files: {}".format(args.filepath))
    print('with license: "{}"'.format(args.license))

    if args.dryrun:
        return

    for fp in args.filepath:
        with open(fp) as fi:
            game_data = workjson.loads(fi.read())
        game_data["license"] = args.license

        with open(fp, 'w') as fo:
            fo.write(workjson.dumps(game_data))


if __name__ == '__main__':
    main()
