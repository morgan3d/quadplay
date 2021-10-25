#!/usr/bin/env python

""" Sorts JSON file.  Useful for maintaining diff consistency. """

import argparse
import workjson


def parse_args():
    """ parse arguments out of sys.argv """
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )
    parser.add_argument(
        'filepath',
        type=str,
        nargs='+',
        help='Files that do stuff'
    )
    return parser.parse_args()


def main():
    """main function for module"""
    args = parse_args()

    for fp in args.filepath:
        with open(fp) as fi:
            contents = fi.read()

        data = workjson.loads(contents)

        with open(fp, 'w') as fo:
            fo.write(
                workjson.dumps(
                    data,
                    sort_keys=True,
                    indent=4,
                    separators=(",", ": ")
                )
            )


if __name__ == '__main__':
    main()
