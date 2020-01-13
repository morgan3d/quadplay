#!/bin/sh
# -*- python -*-
#
#

import betterjson, argparse, sys, urllib, os

if (sys.version_info[0] < 3) or (sys.version_info[0] == 3 and sys.version_info[1] < 1):
   raise Exception("quaddepend.py requires Python 3.1 or later")


def _is_http(path): return path.startswith('http://') or path.startswith('https://')


def _is_quad(path): return path.startswith('quad://')


def _read_filename(path):
   with open(path, 'rt') as f:
      return f.read()

   
def _read_url(path):
   with urllib.request.urlopen(path) as u:
      return u.read()

   
def _error(msg):
   print('ERROR: ' + msg, file=sys.stderr)
   sys.exit(-1)


# Prints recursive dependencies
def _depend_asset(filename, args, basepath):
   asset_data, resolved_filename = _depend(filename, args, basepath, True)
   resolved_dirname = os.path.dirname(resolved_filename)
   
   if asset_data != None:
      asset_data = betterjson.loads(asset_data)
      if filename.endswith('.sprite.json') or filename.endswith('.font.json') or filename.endswith('.sound.json'):
         if not 'url' in asset_data:
            print('WARNING: ' + filename + ' is missing the "url" field', file=sys.stderr)
            return
         
         _depend(asset_data['url'], args, resolved_dirname)
         
      elif filename.endswith('.map.json'):
         if not 'url' in asset_data:
            print('WARNING: ' + filename + ' is missing the "url" field', file=sys.stderr)
            return
         
         _depend(asset_data['url'], args, resolved_dirname)

         if 'spriteUrl' in asset_data:
            _depend_asset(asset_data['spriteUrl'], args, resolved_dirname)
         elif 'spriteUrlTable' in asset_data:
            for s in asset_data['spriteUrlTable'].values():
               _depend_asset(s, args, resolved_dirname)
         else:
            print('WARNING: ' + filename + ' is missing a "spriteUrlTable" or "spriteUrl" field', file=sys.stderr)


def _depend(filename, args, basepath, return_contents = False):
   was_quad = _is_quad(filename)
   if was_quad:
      if not args.allow_quad or args.noquad: return None, filename
      filename = os.path.join(args.root_dir, filename.replace('quad://', ''))

   if _is_http(filename):
      if not args.nohttp:
         print(filename)
         if return_contents: return _read_url(filename), filename
   else:
      if not was_quad and args.nolocal: return None, filename
      
      if not os.path.isfile(filename):
         # See if we can find the file by making it relative to the
         # basepath of its parent
         filename = os.path.join(basepath, filename)
         
      if not os.path.isfile(filename):
         print('WARNING: ' + filename + ' not found', file=sys.stderr)
      else:
         print(filename)
         if return_contents: return _read_filename(filename), filename

   return None, filename
         
   
def quaddepend(args):
   args.allow_quad = os.path.isfile('quadplay')
   args.root_dir = ''
   
   # All filenames are printed relative to the current directory (like unix `find` does)
   game_filename = args.filename[0]
   game_data = None
   was_quad = _is_quad(game_filename)
   
   if was_quad:
      # Resolve to a filename
      if not args.allow_quad: _error('Cannot read a quad:// game when quadplay is not in the current working directory')
      game_filename = game_filename[len('quad://'):]
      # Fall through to the local case

            
   # Handle the case where the argument does not end
   # in .game.json because it is a path
   if not game_filename.endswith('.game.json'):
      game_filename = os.path.join(game_filename, os.path.basename(os.path.join(game_filename, '')[:-1]) + '.game.json')

   if not args.nogame:
      if was_quad:
         print('quad://' + game_filename)
      else:
         print(game_filename)
      
   if _is_http(game_filename):
      game_data = _read_url(game_filename)
   else: # Must be local
      game_data = _read_filename(game_filename)

   basepath = os.path.dirname(game_filename)
      
   # Parse
   game_data = betterjson.loads(game_data)

   if args.docs:
      for f in game_data.get('docs', []):
         _depend(f, args, basepath)

   for f in game_data.get('scripts', []):
      _depend(f, args, basepath)

   for f in game_data.get('assets', {}).values():
      _depend_asset(f, args, basepath)

   for f in game_data.get('modes', []):
      _depend(f.replace('*', '') + '.pyxl', args, basepath)

   for c in game_data.get('constants', {}).values():
      if isinstance(c, dict):
         if (c.get('type', '') == 'raw') and ('url' in c):
            _depend(c['url'], args, basepath)
   

if __name__== '__main__':
   parser = argparse.ArgumentParser(description='Export dependencies of a quadplay game.json game file')
   parser.add_argument('filename', nargs=1, help='The path to the game.json file from the current directory, or the path to the directory containing it if the directory and file have the same basename.')
   parser.add_argument('--nogame', action='store_true', default=False, help='D not print the game.json filename itself')   
   parser.add_argument('--noquad', action='store_true', default=False, help='Exclude quad:// built-in assets. quad:// URLs can only be resolved if the current working directory is the root of a quadplay tree. They will be converted to filenames relative to the current working directory')
   parser.add_argument('--nohttp', action='store_true', default=False, help='Exclude http:// and https:// cloud assets')
   parser.add_argument('--nolocal', action='store_true', default=False, help='Exclude assets with filenames relative to the game')
   parser.add_argument('--docs', action='store_true', default=False, help='Include docs assets. Will not recursively process dependencies of the docs themselves.')
   quaddepend(parser.parse_args())

