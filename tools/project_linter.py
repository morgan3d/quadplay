#!/usr/bin/env python

import argparse
import os
import workjson as json
import filecmp


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
    "default_label_64": (
        "Default label64.  For a default image, press Shift+F6 while the game"
        "is running in the IDE, copy the image to the project directory."
        "Otherwise look in the manual for instructions on how to make your"
        "own.",
        "bool"
    ),
    "default_label_128": (
        "Default label128.  For a default image, press Shift+F6 while the game"
        "is running in the IDE, copy the image to the project directory."
        "Otherwise look in the manual for instructions on how to make your"
        "own.",
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
    parser.add_argument(
        '-m',
        '--mode',
        choices=["report", "manifest", "subdirs"],
        default="report",
        help=(
            'Which mode of operation.  Report: print a report and quit.'
            'Manifest: print the manifest of relevant files for this project.'
        ),
    )

    return parser.parse_args()


def _fetch_asset_path(blob, asset):
    # fetch the target file out
    asset_url = blob.get("url")
    blob_dir = os.path.dirname(asset)
    return os.path.join(blob_dir, asset_url)


def lint_game(game_name=None, license_audit=False, verbose=False):
    if not game_name:
        game_name = os.path.basename(os.getcwd())
        if verbose:
            print(f"detected game: {game_name}")

    if game_name.endswith(".game.json"):
        game_json_path = game_name
    else:
        game_json_path = f"{game_name}.game.json"

    if not os.path.exists(game_json_path):
        raise RuntimeError(
            f"No such game.json: {game_json_path}.  Linter expects to run in "
            "the same directory as the game.json for the project to lint."
        )

    with open(game_json_path, encoding="utf-8", errors="replace") as fi:
        game_data = json.loads(fi.read())

    report = {}

    # find files
    files = [f for f in game_data["scripts"] if not f.startswith("quad://")]
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
        for _, key in enumerate(game_data[bucket].keys()):
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

        files.append(asset)

        with open(asset, encoding='utf-8', errors='replace') as fi:
            blob = json.loads(fi.read())

        lic = blob.get("license")
        if not lic or lic.lower() == "none":
            report.setdefault("no_license", []).append(asset)
        else:
            licenses.setdefault(blob['license'], []).append(asset)

        asset_path = _fetch_asset_path(blob, asset)
        if not os.path.exists(asset_path):
            report.setdefault("no_such_file", []).append(asset_path)
        else:
            files.append(asset_path)

    files.append(game_json_path)
    report["files"] = files

    if license_audit:
        report['license_audit'] = licenses

    if not os.path.exists('preview.png'):
        report["no_preview_png"] = True

    if not os.path.exists('label64.png'):
        report["no_label_64"] = True

    for lblres in [64, 128]:
        lbl = f"label{lblres}"
        lblpath = f'{lbl}.png'
        if not os.path.exists(lblpath):
            report[f"no_label_{lblres}"] = True
        elif filecmp.cmp(
            lblpath,
            os.path.abspath(
                os.path.join(
                    os.path.dirname(__file__),
                    "..",
                    "console",
                    "launcher",
                    lblpath,
                )
            )
        ):
            report[f"default_label_{lblres}"] = True

    return report


def print_report(report, fields, license_audit):
    if license_audit:
        for license in report['license_audit']:
            print("License: '{}'".format(license))
            for fname in report["license_audit"][license]:
                print("  {}".format(fname))

    found_errors = False

    for report_field in REPORT_MAP:
        if report_field not in fields or not report.get(report_field):
            continue

        found_errors = True

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

    if not found_errors:
        print("Project Linter didn't detect any problems.")


def main():
    args = parse_args()

    report = lint_game(args.game, args.license_audit, args.mode == "report")

    if args.mode == "manifest":
        # print all the local files this project uses (ie not quad:// stuff)
        print(" ".join(report["files"]))
    elif args.mode == "subdirs":
        # print out local subdirectories
        # filter out empty stuff
        dirs = (
            d for d in set(
                os.path.dirname(fp) for fp in report["files"]
            ) if d
        )

        print(" ".join(dirs))
    else:
        print_report(report, args.field, args.license_audit)


if __name__ == '__main__':
    main()
