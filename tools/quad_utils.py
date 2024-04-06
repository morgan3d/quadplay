import os
import workjson


def detect_default_game():
    """try and detect based on the current directory"""

    return os.path.basename(os.getcwd())


def load_game_json(game):
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

    return game_data


def write_game_json(game, game_data):
    """write game_data to game"""

    if not game.endswith(".json"):
        game += ".game.json"

    with open(game, 'w') as fo:
        fo.write(
            workjson.dumps(
                game_data,
                sort_keys=True,
                indent=4, separators=(",", ": ")
            )
        )
