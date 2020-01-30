#!/usr/bin/env python3
# -*- python -*-
# tools/export.py --dry-run --standalone -o export games/serpitron

import argparse, sys, os, workjson, types, shutil
from quaddepend import quaddepend

# This implementation needs f-strings from Python 3.6
if (sys.version_info[0] < 3) or (sys.version_info[0] == 3 and sys.version_info[1] < 6): raise Exception("export.py requires Python 3.1 or later")

# Add the quadplay OS dependencies
sys.path.append('console/os')
from dependencies import os_dependencies

# Returns a list of dependencies and the
# title of the game as a tuple
def get_game_dependency_list(args, game_path):
   # Convert the OS dependencies to a list
   os_dependency_list = [url[len('quad://'):] for url in os_dependencies.values()]

   # Include the OS dependencies unless standalone
   depends = os_dependency_list if args.standalone else []
   
   title = 'Game'
   def callback(filename): depends.append(filename)

   def title_callback(t):
      nonlocal title
      title = t

   qdargs = types.SimpleNamespace()
   qdargs.allow_quad = args.standalone
   qdargs.noquad     = False
   qdargs.nogame     = False
   qdargs.nohttp     = True
   qdargs.nolocal    = False
   qdargs.filename   = [game_path]
   qdargs.callback   = callback
   qdargs.docs       = False
   qdargs.title_callback =  title_callback
   quaddepend(qdargs)
   
   return (depends, title)


def write_text_file(filename, contents):
   f = open(filename, 'wt')
   f.write(contents)
   f.close()


# Source code for the index.html page when making a standalone program
def generate_embedded(args, out_path, game_path, game_title):
   htmlSource = f"""
<!DOCTYPE html>
<html>
  <head>
    <title>{game_title}</title>
    <meta charset="utf-8">
  </head>
  <body style="margin: 0; background: #000">
    <iframe src="console/quadplay.html&fastReload=1&game={game_path}" style="width: 100%; height: 100%"></iframe>
  </body>
</html>
"""
   if args.dry_run:
      print('write index.html = ', htmlSource)
   else:
      write_text_file(os.path.join(out_path, 'index.html'), htmlSource)

   
   
def generate_redirect(args, out_path, game_path, game_title):
   # Construct the game url
   url = args.hosturl
   if url[-1] != '/': url += '/'
   url += game_path

   url = 'https://morgan3d.github.io/quadplay/console/quadplay.html&fastReload=1&game=' + url
   
   htmlSource = f"""
<!DOCTYPE html>
<html>
  <head>
    <title>{game_title}</title>
    <meta charset="utf-8"/>
    <meta http-equiv="refresh" content="0;URL='{url}'"/>
  </head>
  <body onload="location={url}">
  </body>
</html>
"""
   if args.dry_run:
      print('write index.html = ', htmlSource)
   else:
      write_text_file(os.path.join(out_path, 'index.html'), htmlSource)
   

   
def export(args):
   game_path = args.gamepath[0]

   out_path = args.outpath

   # Will be read  from the JSON file
   game_title = ''
   
   # Handle the case where the argument does not end
   # in .game.json because it is a path
   if not game_path.endswith('.game.json'):
      game_path = os.path.join(game_path, os.path.basename(os.path.join(game_path, '')[:-1]) + '.game.json')

   (game_dependency_list, game_title) = get_game_dependency_list(args, game_path)

   # Create out_path if it does not exist
   if not os.path.isdir(out_path):
      if args.dry_run: print('mkdir -p ' + out_path)
      else: os.makedirs(out_path, exists_ok = True)

   for src in game_dependency_list:
      dir = os.path.join(out_path, os.path.dirname(src))
      # Makedirs as needed, but don't print on every single file in the dry_run
      if not os.path.isdir(dir) and not args.dry_run:
         os.makedirs(dir, exists_ok = True)

      dst = os.path.join(out_path, src)
      if args.dry_run: print('cp ' + src + ' ' + dst)
      else: shutil.copy2(src, dst)
         
   
   if args.standalone:
      # Recursively copy everything from 'console/' to out_path
      if args.dry_run: print('cp -r console ' + os.path.join(out_path, ''))
      else: shutil.copytree('console', os.path.join(out_path, ''))
      
      generate_embedded(args, out_path, game_path, game_title)
   elif args.hosturl:
      # TODO: if game_path is not a subdirectory of the quadplay directory,
      # then we need to make a relative file structure in the out_path
      generate_redirect(args, out_path, game_path, game_title)
      print('Unimplemented, sorry')
   else:
      print('ERROR: Either --hosturl or --standalone must be specified.')     
      


if __name__== '__main__':
   parser = argparse.ArgumentParser(description='Export a distributable static HTML game from a game.json game file.\n\n' + 'Example: tools/export.py -o ../www/ games/serpitron')
   parser.add_argument('gamepath', nargs=1, help='the path to the game.json file from the current directory, or the path to the directory containing it if the directory and file have the same basename. For the current version of this script, the game must be in a subdirectory of the quadplay directory. This will be generalized later.')
   parser.add_argument('-o', '--outpath', required=True, help='output directory to put the game in, relative to the current directory')
   parser.add_argument('--standalone', action='store_true', default=False, help='generate a standalone game that does not depend on morgan3d.github.io/quadplay. This produces a larger export, but locks down the quadplay version and can run offline.')
   parser.add_argument('--hosturl', help='url for the directory at which your game will be hosted. Required if not standalone. Example: youraccount.github.io/yourgame/')
   parser.add_argument('--dry-run', '-n', action='store_true', default=False, help='print the files that would be created but do not touch the filesystem.')

   args = parser.parse_args()

   # Ensure that the program is being run from the quadplay directory
   # so that relative paths can be resolved
   if not os.path.isfile('quadplay'):
      print('ERROR: Must be run from the quadplay directory as "tools/export.py" or "python3 tools/export.py"', file=sys.stderr)
      sys.exit(-1)

   export(args)
