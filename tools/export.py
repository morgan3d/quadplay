#!/usr/bin/env python3
# -*- python -*-

import argparse, sys, os, types, shutil, tempfile, stat, workjson
from quaddepend import quaddepend, depend_asset

# This implementation needs f-strings from Python 3.6
if (sys.version_info[0] < 3) or (sys.version_info[0] == 3 and sys.version_info[1] < 6): raise Exception("export.py requires Python 3.1 or later")

# Add the quadplay OS dependencies.py and workjson.py
sys.path.append(os.path.join(os.path.dirname(__file__), '../console/os'))
from dependencies import os_dependencies

# Returns a list of dependencies and the
# title of the game as a tuple
def get_game_dependency_list(args, game_path):
   # Include the OS dependencies unless standalone
   depends = []   
   title = 'Game'
   
   def callback(filename):
      depends.append(os.path.join(os.path.dirname(game_path), filename))
      
   def title_callback(t):
      nonlocal title
      title = t

   qdargs = types.SimpleNamespace()
   qdargs.allow_quad = not args.noquad
   qdargs.noquad     = False
   qdargs.nogame     = False
   qdargs.nohttp     = True
   qdargs.nolocal    = False
   qdargs.filename   = [game_path]
   qdargs.callback   = callback
   qdargs.docs       = False
   qdargs.title_callback = title_callback
   qdargs.quadpath   = args.quadpath
   quaddepend(qdargs)
   
   if not args.noquad:
      # Process the additional quadOS dependencies
      qdargs.root_dir = ''
      qdargs.allow_quad = True
      for url in os_dependencies.values():
         depend_asset(url, qdargs, '.')
   
   return (depends, title)


def write_text_file(filename, contents):
   f = open(filename, 'wt')
   f.write(contents)
   f.close()


# Source code for the index.html page when making a standalone program
def generate_standalone(args, out_path, game_path, game_title):
   # Get the favicon path and copy it
   favicon_path, is_game_icon, favicon_size = get_favicon_path(args, game_path)
   favicon_rel_path = copy_favicon(args, out_path, favicon_path, is_game_icon)
   
   htmlSource = f"""
<!DOCTYPE html>
<html>
  <head>
    <title>{game_title}</title>
    <meta charset="utf-8">
    <link rel="icon" href="{favicon_rel_path}">
    <link rel="icon" type="image/png" sizes="{favicon_size}x{favicon_size}" href="{favicon_rel_path}">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  </head>
  <body style="margin: 0; background: #000; position: absolute; top: 0; bottom: 0; left: 0; right: 0">
    <iframe src="console/quadplay.html?fastReload=1&game={game_path}&quit=reload" style="width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; border: none" allow="gamepad; fullscreen *; autoplay" msallowfullscreen="true" allowfullscreen="true" webkitallowfullscreen="true"></iframe>
  </body>
</html>
"""
   if args.dry_run:
      print('write index.html = ', htmlSource)
   else:
      write_text_file(os.path.join(out_path, 'index.html'), htmlSource)

   
   
def generate_remote(args, out_path, game_path, game_title):
   # Get the favicon path and copy it
   favicon_path, is_game_icon, favicon_size = get_favicon_path(args, game_path)
   favicon_rel_path = copy_favicon(args, out_path, favicon_path, is_game_icon)
   
   htmlSource = f"""
<!DOCTYPE html>
<html>
  <head>
    <title>{game_title}</title>
    <meta charset="utf-8"/>
    <link rel="icon" href="{favicon_rel_path}">
    <link rel="icon" type="image/png" sizes="{favicon_size}x{favicon_size}" href="{favicon_rel_path}">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  </head>
  <body style="margin: 0; background: #000; position: absolute; top: 0; bottom: 0; left: 0; right: 0">
    <script>
      document.write('<iframe src="https://morgan3d.github.io/quadplay/console/quadplay.html#fastReload=1&game=' + 
          (location + '').replace(/\\/[^/]*$/, '/') + 
          '{game_path}&quit=reload" style="width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; border: none" allow="gamepad; fullscreen *; autoplay" msallowfullscreen="true" allowfullscreen="true" webkitallowfullscreen="true"></iframe>');
    </script>
  </body>
</html>
"""
   if args.dry_run:
      print('write index.html = ', htmlSource)
   else:
      write_text_file(os.path.join(out_path, 'index.html'), htmlSource)
   

   
def export(args):
   game_path = None

   if args.game:
      game_path = os.path.abspath(args.game)
   else:
      game_path = os.getcwd()
      
   # Handle the case where the argument does not end
   # in .game.json because it is a path
   if not game_path.endswith('.game.json'):
      game_path = os.path.join(game_path, os.path.basename(os.path.join(game_path, '')[:-1]) + '.game.json')


   if not os.path.isfile(game_path):
      print('ERROR: ' + game_path + ' not found.\nChange directory to your game directory or use the -g argument.')
      sys.exit(-3)
      
   if not args.outpath and not args.zipfile:
      args.zipfile = os.path.basename(game_path).replace('.game.json', '.zip')
   
   out_path = args.outpath

   if args.zipfile:
      # Make a temporary output. This will be deleted automatically
      # by python when tempdir goes out of scope at the end of export()
      tempdir = tempfile.TemporaryDirectory()
      out_path = tempdir.name
   else:
       tempdir = None
   
   # Will be read from the JSON file
   game_title = ''
   
   # Strip from source
   base_path = os.path.join(os.path.dirname(game_path), '')
   
   # Add to dest
   out_subdir = os.path.basename(os.path.dirname(game_path))

   out_url = out_subdir + '/' + os.path.basename(game_path)
   
   (game_dependency_list, game_title) = get_game_dependency_list(args, game_path)

   if os.path.exists(out_path):
       if args.force:
           shutil.rmtree(out_path)
       elif not tempdir:
           raise RuntimeError(
               f"Path '{out_path}' exists.  To overwrite use the "
               "--force option.")

   # Create out_path if it does not exist
   if not os.path.isdir(out_path):
       if args.dry_run: print('mkdir -p ' + out_path)
       else: os.makedirs(out_path, exist_ok = True)
   
   if not args.noquad:
      # Files and directories in console/ that are not needed for exported games
      # because they are part of the IDE only
      ignore_files = ['launcher', 'templates', 'ace', 'lib/qrcode.min.js', 'lib/dagre.min.js',
                      'quadplay-ide-asset.js', 'quadplay-ide-code.js', 'quadplay-ide-constant.js',
                      'quadplay-ide-sprite.js', 'quadplay-ide-mode-diagram.js', 'quadplay-vs.js']

      # Recursively copy everything from 'console/' to out_path
      # Do this before copying individual dependencies because
      # shutil.copytree can't take the dirs_exist_ok=True parameter
      # until Python 3.8 and the dependencies create the console dir
      if args.dry_run:
         print('cp -r ' + os.path.join(args.quadpath, 'console') + ' ' + os.path.join(out_path, ''))
         for f in ignore_files:
             print('rm -rf ' + os.path.join(out_path, 'console/' + f))
      else:             
          shutil.copytree(os.path.join(args.quadpath, 'console'),
                          os.path.join(out_path, 'console'),
                          ignore = shutil.ignore_patterns('.DS_Store', '*~', '#*', '*.psd', '*.kra', 'Makefile', '*.zip', '*.pyc', '__pycache__', *ignore_files))
      
      generate_standalone(args, out_path, out_url, game_title)
   else:
      generate_remote(args, out_path, out_url, game_title)

      
   for src in game_dependency_list:
      if src.startswith(base_path):
         dst = os.path.join(out_path, out_subdir, src[len(base_path):])
      elif src.startswith(args.quadpath):
         dst = os.path.join(out_path, src[len(args.quadpath)+1:])
      else:
         dst = os.path.join(out_path, src)
         
      dir = os.path.dirname(dst)
      # Makedirs as needed, but don't print on every single file in the dry_run
      if not os.path.isdir(dir) and not args.dry_run:
         os.makedirs(dir, exist_ok = True)

      if args.dry_run: print('cp ' + src + ' ' + dst)
      else: shutil.copy2(src, dst)

      
   # Make everything world-readable
   if args.dry_run:
       print('chmod -R uga+r ' + os.path.join(out_path, '*'))
   else:
       for root, dirs, files in os.walk(out_path):
           # Make dirs readable and executable. Make them user writable
           # so that the temp dir can be deleted as well!
           for name in dirs:
               try:
                   os.chmod(os.path.join(root, name),
                            stat.S_IRUSR | stat.S_IROTH | stat.S_IRGRP |
                            stat.S_IXUSR | stat.S_IXGRP | stat.S_IRWXO |
                            stat.S_IWUSR)
               except:
                  pass

           # Make files readable
           for name in files:
               try:
                   os.chmod(os.path.join(root, name), stat.S_IRUSR | stat.S_IROTH | stat.S_IRGRP | stat.S_IWUSR)
               except:
                   print('Warning: could not set read permission on', os.path.join(root, name))

         
   if args.zipfile:
      # Construct the zipfile
      if args.dry_run: print('zip -c ' + args.zipfile + ' ' + out_path)
      else:
         # Delete the file if it exists so that we won't zip it into itself
         if os.path.isfile(args.zipfile): os.remove(args.zipfile)
         old_dir = os.getcwd()
         os.chdir(out_path)
         shutil.make_archive(os.path.join(old_dir, os.path.splitext(args.zipfile)[0]), 'zip')
         os.chdir(old_dir)
         print('Generated ' + os.path.abspath(args.zipfile))
  
      

def get_favicon_path(args, game_path):
    """Returns the path to the favicon to use, whether it's from the game or console, and its size."""
    base_path = os.path.dirname(game_path)
    
    # Check for label128.png first
    label128 = os.path.join(base_path, 'label128.png')
    if os.path.exists(label128):
        return label128, True, 128
        
    # Then check for label64.png
    label64 = os.path.join(base_path, 'label64.png')
    if os.path.exists(label64):
        return label64, True, 64
        
    # Default to console favicon
    return os.path.join(args.quadpath, 'console/icons/favicon-120x120.png'), False, 120

def copy_favicon(args, out_path, favicon_path, is_game_icon):
    """Copies the favicon to the output directory and returns the relative path."""
    if is_game_icon:
        # For game icons, copy to the root of the output directory
        dst = os.path.join(out_path, 'favicon.png')
        if not args.dry_run:
            shutil.copy2(favicon_path, dst)
        return 'favicon.png'
    else:
        # For console icons, copy to the console directory
        dst = os.path.join(out_path, 'console/icons/favicon-120x120.png')
        if not args.dry_run:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(favicon_path, dst)
        return 'console/icons/favicon-120x120.png'

if __name__== '__main__':
   parser = argparse.ArgumentParser(description='Export a distributable static HTML game from a game.json game file named on the command line.\n\n', formatter_class=argparse.ArgumentDefaultsHelpFormatter)
   parser.add_argument('game', action='store', default='./', nargs='?', help='the path to the game.json file from the current directory, or the path to the directory containing it if the directory and file have the same basename.')
   parser.add_argument('-o', '--outpath', help='output to this directory instead of a zipfile. Relative to the current directory.')
   parser.add_argument('-z', '--zipfile', help='name of the zipfile, relative to the current directory. Defaults to the game name if unspecified.')
   parser.add_argument('--noquad', action='store_true', default=False, help='reduce the export size by making referencing the public quadplay distribution instead of embedding it.')
   parser.add_argument('--dry-run', '-n', action='store_true', default=False, help='print the files that would be created but do not touch the filesystem.')
   parser.add_argument('--force', '-f', action='store_true', default=False, help='Overwrite the destination if it already exists.')

   args = parser.parse_args()

   # Run from the quadplay path
   args.quadpath = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

   if args.outpath and args.zipfile:
      print('ERROR: Only one of -o and -z can be specified')
      sys.exit(-2)

   export(args)
