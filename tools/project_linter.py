#!/usr/bin/env python

import argparse
import os
import workjson as json


__doc__ = """ A tool for linting quadplay game projects for finaling.  """


KEYS_TO_APPEAR_IN_FILES = ["assets", "constants"]

REPORT_MAP = {
    "unused_stuff": ("Unused things in game.json['{}']", "map"),
    "no_license": ("Assets without a license", "list"),
    "no_such_file": ("Assets whose files do not exist", "list"),
    "no_preview_png": (
        "No preview.png!\n  Press shift+f8 to record a small gameplay preview "
        "for the launcher.",
        "bool"
    ),
    "no_label_64": (
        "no label64 image.  Press Shift+F6 while the game is running in the "
        "IDE.",
        "bool"
    ),
    "no_label_128": (
        "no label128 image.  Press Shift+F6 while the game is running in the "
        "IDE.",
        "bool"
    ),
}


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
        '-f',
        '--field',
        nargs='*',
        default=REPORT_MAP.keys(),
        help="Fields in the report to include."
    )
    parser.add_argument(
        '-g',
        '--game',
        type=str,
        default=None,
        help='Name of the game to lint.'
    )
    parser.add_argument(
        '-l',
        '--license-audit',
        action="store_true",
        default=False,
        help='Print out an audit of all the licenses used in the project.'
    )

    return parser.parse_args()


def lint_game(game_name=None, license_audit=False):
    if not game_name:
        game_name = os.path.basename(os.getcwd())
        print("detected game: {}".format(game_name))

    if game_name.endswith(".game.json"):
        game_json_path = game_name
    else:
        game_json_path = "{}.game.json".format(game_name)

    if not os.path.exists(game_json_path):
        raise RuntimeError("No such game.json: {}".format(game_json_path))

    with open(game_json_path, encoding="utf-8", errors="replace") as fi:
        game_data = json.loads(fi.read())

    report = {}

    # find files
    files = game_data["scripts"][:]
    files.extend(("{}.pyxl".format(m) for m in game_data["modes"]))
    files.extend(
        thing.get("url")
        for thing in game_data["constants"].values()
        if isinstance(thing, dict)
        and thing["type"] == "raw"
        and thing.get("url", None) is not None

    )

    # cache all the files... who knows
    all_text = ""
    for f in files:
        if f.startswith("quad://"):
            continue

        with open(f, encoding='utf-8', errors='replace') as fi:
            all_text += fi.read()

    # unused things
    for bucket in KEYS_TO_APPEAR_IN_FILES:
        for ind, key in enumerate(game_data[bucket].keys()):
            if key not in all_text:
                report.setdefault(
                    "unused_stuff",
                    {}
                ).setdefault(bucket, []).append(key)

    licenses = {}
    for asset in game_data["assets"].values():
        if asset.startswith('quad://'):
            continue

        if not os.path.exists(asset):
            report.setdefault("no_such_file", []).append(asset)
            continue

        with open(asset, encoding='utf-8', errors='replace') as fi:
            blob = json.loads(fi.read())

        lic = blob.get("license")
        if not lic or lic.lower() == "none":
            report.setdefault("no_license", []).append(asset)
        else:
            licenses.setdefault(blob['license'], []).append(asset)

    if license_audit:
        report['license_audit'] = licenses

    if not os.path.exists('preview.png'):
        report["no_preview_png"] = True

    if not os.path.exists('label64.png'):
        report["no_label_64"] = True

    if not os.path.exists('label128.png'):
        report["no_label_128"] = True

    return report


def print_report(report, fields, license_audit):
    if license_audit:
        for license in report['license_audit']:
            print("License: '{}'".format(license))
            for fname in report["license_audit"][license]:
                print("  {}".format(fname))

    for report_field in REPORT_MAP:
        if report_field not in fields or not report.get(report_field):
            continue

        (label, kind) = REPORT_MAP[report_field]
        if kind == "list":
            print("{}:".format(label))
            for child in report.get(report_field, []):
                print("  {}".format(child))
        elif kind == "map":
            for thing, child in report[report_field].items():
                print("{}:".format(label.format(thing)))
                for key in child:
                    print("  {}".format(key))
        elif kind == "bool":
            if report[report_field]:
                print(label)


def main():
    args = parse_args()

    report = lint_game(args.game, args.license_audit)

    print_report(report, args.field, args.license_audit)


if __name__ == '__main__':
    main()
