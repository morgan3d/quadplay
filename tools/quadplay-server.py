# This is the quadplay server script. The quadplay server is a stock
# web server with the following extensions:
#
#  - POST commands take a JSON argument with a `command` that is:
#    
#    "write_file":    Write the specified contents to disk at the specified location.
#                     Used by the IDE to save files.
#
#    "new_game":      Create a new game by copying and renaming the specified template
#                     and return the URL of the new game, or return an error if the
#                     directory already existed.
#
#    "open":          Open the specified file in finder/explorer or using an external
#                     application editor
#
#    "quit":          Shut down the server itself (only in --nativeapp mode)
#
#    "update":        Update quadplay via git pull or downloading from github, depending on how it was installed
#
#    "export_game":   Export the specified game to a zip file
#
#  - GET commands:
#
#    - Are limited to the quadplay directory, the directory passed on the
#      command line, and $HOME/my_game
#
#    - Special quad_filepath + '/console/' + ... URLs that on a
#      quadplay server are dynamically generated instead of files:
#
#       - `_assets.json` gives a listing of all assets in the
#         specified query directory and the quadplay built-in
#         directories.  This combines raw and json packaged assets.
#
#       - `_scripts.json` gives a listing of all .pyxl files in
#         the specified query directory and the quadplay built-in
#         scripts directory.
#
#       - `_docs.json` gives a listing of all .md, .html, and
#         .pdf files in the specified query directory.
#
#       - `games.json` gives a listing of all games in subdirectories
#         of examples/, games/, and my_quadplay/ (not recursive). This
#         is backed by an actual file when not using a quadplay
#         server.
#
#       - `_config.json` describes the available external
#         applications, which are a subset of
#         console/external-applications.json. Also includes
#         information on the git version when running from private
#         developer git.
#
#       - `_update_progress.json` reports on the status of the update
#         thread once launched.
#
#       - `_git` executes the command specified in the query in the
#         specified directory and then returns the output, with the
#         return code on the last line
#
# A "path" in this code is a file-system path, where '/' means the filesystem true root
#
# A "webpath" is a URL subpath, where '/' means the server root = filesystem root_path


# --git-dir (dir)
# --work-tree (dir)

import os, time, platform, sys, threading, socket, argparse, multiprocessing, json, ssl, codecs, glob, shutil, re, base64, random, getpass, inspect, subprocess, workjson, signal, shlex, tkinter, tkinter.messagebox, urllib, urllib.request, types, tempfile, stat

quadplay_origin = 'git clone' if os.path.isdir(os.path.join(os.path.dirname(__file__), '../.git')) else 'downloaded release'
if quadplay_origin == 'git clone' and os.path.exists(os.path.join(os.path.dirname(__file__), '../_dev')):
    quadplay_origin = 'development git clone'

# Catch a operator error with git. This binary file should be large if LFS is present:
if quadplay_origin == 'development git clone' and os.stat(os.path.join(os.path.dirname(__file__), '../console/xbox_controller.png')).st_size < 1000:
    print('You are running the development build of quadplay without git LFS, so the binary files are not present. Enable LFS and pull.')
    sys.exit(2)

# If needed, this is how we'd restrict the version. The current implementation does not need to restrict the version:
# if sys.version_info[0] < 3 or sys.version_info[1] < 7:
#     print('Sorry, you are using Python ' + sys.version + ' and quadplay requires Python 3.7 or newer. Download and install from https://python.org')
#     sys.exit(-1)

__doc__ = "quadplay console server"

python_version = str(sys.version_info.major) + '.' + str(sys.version_info.minor)

# Largest common prefix of quad_filepath and game_filepath. Root for web serving
server_root_filepath = None

# Path to the token.txt file
token_absfilepath = None

# Magic paths that the browser will use to communicate that it wants
# an asset listing or game listing for import in IDE mode. Any command
# ending in /_git will be a git command
asset_query_webpath = None
script_query_webpath = None
doc_query_webpath = None
game_query_webpath = None
config_query_webpath = None
update_progress_query_webpath = None

# Subdirectories of server_root_filepath that are permitted for http access.
# These are relative to server_root_filepath and contain a leading slash because
# they are url subpaths relative to quad://
webpath_allowlist = None

isWindows = (platform.system() == 'Windows')
isMacOS   = (platform.system() == 'Darwin')
isLinux   = (platform.system() == 'Linux')
hasGit = shutil.which('git') != None

# Authentication token, used to ensure that only browsers launched by this server can
# ask it to POST
token = None

def ignore(*args): pass

# Assigned in main based on the --quiet flag
maybe_print = ignore

##########################################################################
# Version detection

# Parses a version.js file with an embedded 'version = yyyy.mm.dd.hh'
# string and returns it as a single integer for version comparisons,
# as well as the human-readable version string.
def parse_version_js(file_string):
    version_parser = re.compile("^ *const *version *= *['\"]([.0-9]+)*['\"] *;")
    try:
        version_string = version_parser.search(file_string).group(1)
        
        year, month, day, hour = [int(x) for x in version_string.split('.')]
        
        # Months and years have varying length. That doesn't matter.  We
        # don't need a linear time number. We need one that monotonically
        # increases. Think of this as parsing a number with an irregular
        # base per digit.
        return {'value': ((year * 12 + month) * 32 + day) * 24 + hour,
                'text': version_string}
    except:
        
        return {'value': 0, 'text': file_string}
    
with open(os.path.join(os.path.dirname(__file__), '../console/version.js')) as file:
    installed_quadplay_version = parse_version_js(file.read())

##########################################################################


# Ensure that slashes and case are consistent when on Windows, and make absolute
def canonicalize_filepath(path): return os.path.normcase(os.path.abspath(path)).replace('\\', '/').replace('//', '/')

def fatal_error(message):
    # Initialize the GUI
    window_root = tkinter.Tk()
    window_root.withdraw()

    # Message Box
    print("Quadplay Error: " + message)
    tkinter.messagebox.showerror("Quadplay Error", message)
    sys.exit(-1)


def parse_args():
    """ parse arguments out of sys.argv """
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )
    
    parser.add_argument(
        '--serve',
        action='store_true',
        default=False,
        help='serving mode - allow other machines to connect to this one to develop on mobile devices'
    )

    parser.add_argument(
        '--nativeapp',
        action='store_true',
        default=False,
        help='Attempt to open quadplay as a native app window on platforms with Chromium (Chrome, Brave, or Edge). Defaults to True for the quadplay script and False for the quadplay-server script.'
    )

    parser.add_argument(
        '--quiet',
        action='store_true',
        default=False,
        help='Minimize console output, eliminating the console window itself if possible.'
    )

    parser.add_argument(
        '--my_quadplay',
        default=os.environ.get('MY_QUADPLAY', '~/my_quadplay'),
        help="Set the path to local games, which defaults to my_quadplay in the current user's home directory or the MY_QUADPLAY environment variable."
    )

    parser.add_argument(
        '--noupdatecheck',
        default=False,
        help="Do not check for newer versions of quadplay on github. Never checks when in kiosk mode")

    parser.add_argument(
        '--nosleep',
        default=False,
        help="Do not allow sleeping (for attract mode displays)")

    parser.add_argument(
        'gamepath',
        type=str,
        default='',
        nargs='?',
        help=(
            'Game to load.  If not specified, loads a default game.'
            ' Example: examples/accel_demo'
        )
    )
    
    parser.add_argument(
        '--kiosk',
        action='store_true',
        default=False,
        help='kiosk mode - launch full screen, without the IDE or other controls'
    )

    parser.add_argument(
        '--play',
        action='store_true',
        default=False,
        help='play mode - launch without the IDE'
    )

    parser.add_argument(
        '--offline',
        action='store_true',
        default=False,
        help='Prevent online multiplayer as both host and guest'
    )

    parser.add_argument(
        "-p",
        "--port",
        type=int,
        default=8000,
        help="Port to run the server on."
    )

    return parser.parse_args()


# Args must be initialized to a constant before launchServer is defined
# because of the way that multiprocess serialization works on ThreadingHTTPServer
args = parse_args()

# Where the user's games are stored. Will be made relative to the CWD later
my_games_filepath = canonicalize_filepath(os.path.expanduser(args.my_quadplay))

if my_games_filepath.find(' ') != -1:
    fatal_error("The my_quadplay directory (" + my_games_filepath + ") may not contain spaces in this release. Use the --my_quadplay command line argument to select a path without spaces in the name.")

if len(my_games_filepath) == 0 or (isWindows and (len(my_games_filepath) < 3 or my_games_filepath[1:3] != ':/')) or (not isWindows and (len(my_games_filepath) < 2 or my_games_filepath[0] != '/')):
    fatal_error("The my_quadplay directory (" + my_games_filepath + ") must be an absolute path.")

if not os.path.exists(my_games_filepath):
    if my_games_filepath == canonicalize_filepath(os.path.expanduser('~/my_quadplay')):
        # Create the games path and put a .gitignore in it if there isn't
        # one already
        os.makedirs(my_games_filepath)
        shutil.copyfile('.gitignore', os.path.join(my_games_filepath, '.gitignore'))
    else:
        fatal_error("The specified my_quadplay directory (" + my_games_filepath + ") could not be found.")


def remove_leading_slash(path): return path[1:] if len(path) > 0 and path[0] == '/' else path
def remove_trailing_slash(path): return path[:-1] if len(path) > 0 and path[-1] == '/' else path


try:
    # Python 3.7+
    from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
    QuadplayHTTPServer = ThreadingHTTPServer
    maybe_print('Initializing Quadplay server using Python ' + python_version + ' ThreadingHTTPServer')
    
except ImportError:
    try:
        # Python 3+
        from http.server import HTTPServer, SimpleHTTPRequestHandler
        maybe_print('Initializing Quadplay server using Python ' + python_version + ' HTTPServer')
        QuadplayHTTPServer = HTTPServer
    except ImportError:
        # Python 2
        from SimpleHTTPServer import SimpleHTTPRequestHandler
        import SocketServer
        QuadplayHTTPServer = SocketServer.TCPServer
        maybe_print('Initializing Quadplay server using Python ' + python_version + ' SocketServer.TCPServer')

        
# Returns a string of the line number that calls this function
def this_line_number(): return str(inspect.currentframe().f_back.f_lineno)

##############################################################################      

# Throws an exception with the output on a non-zero error code,
# otherwise returns the command's output.
def run_shell_command(cmd, noExceptions=False, quiet=False):
    if not quiet: maybe_print(cmd)
    
    with os.popen(cmd) as stream:
        output = stream.read()
        if not quiet: maybe_print(output)
        status = stream.close()

        if status:
            if noExceptions:
                return (output, os.waitstatus_to_exitcode(status))
            else:
                raise Exception(output)
        else:
            return (output, 0)


class UpdateThread(threading.Thread):

    def __init__(self):
        super(UpdateThread, self).__init__(name='update_thread', daemon=True)
        self._status = 'Running'
        self._status_lock = threading.Lock()

        
    def set_status(self, value):
        with self._status_lock:
            self._status = value

            
    def get_status(self):
        with self._status_lock:
            return self._status

        
    def run(self):
        try:
            if self.update():
                self.set_status('Done. Restart server.')
            else:
                self.set_status('Done. Restart client.')
        except Exception as e:
            maybe_print('Update failed: ' + str(e))
            self.set_status('Failed: ' + str(e))
            

    # Returns true if the server needs to be restarted.
    # Raises an exception if the update fails.
    def update(self):
        old_dir = os.getcwd()

        # go to the quadplay root dir
        os.chdir(os.path.join(os.path.dirname(__file__), '..'))
    
        # Track if this script itself changed
        my_previous_timestamp = os.path.getmtime(__file__)
    
        try:
            if quadplay_origin == 'git clone' or quadplay_origin == 'development git clone':
                # Verify that we have git
                if not hasGit:
                    raise Exception('Your quadplay was installed via git clone but the updater cannot find the git program to pull the latest version. Delete the .git directory or manually update.')
        
                # Run git
                run_shell_command('git pull')
        
            elif quadplay_origin == 'downloaded release':
                os.mkdir('temp')
                run_shell_command('curl --location --output temp/quadplay-install.zip https://github.com/morgan3d/quadplay/archive/refs/heads/main.zip')
                os.chdir('temp')
                try:
                    run_shell_command('tar -xf quadplay-install.zip')
                
                    # Copy files
                    shutil.copytree('quadplay-main', '..', dirs_exist_ok = True)
                    shutil.rmtree('temp')
                except:
                    # Try to clean up
                    os.chdir('..')
                    shutil.rmtree('temp')
                    raise
        
            # Success
            os.chdir(old_dir)
            return os.path.getmtime(__file__) != my_previous_timestamp
        
        except:
            os.chdir(old_dir)
            raise

        
# The global updating thread. Initialized when the client
# requests the update.
update_thread = None


# Workaround on Windows/Chrome for WebWorker error "refused to execute script from '...js' because its MIME type ('text/plain') is not executable."
SimpleHTTPRequestHandler.extensions_map['.js'] = 'application/javascript'

##############################################################################
# Handles serving from multiple directories. Overrides the default
# restriction to the CWD with its own security allowlist. Instantiated
# per request.
#
# See https://github.com/python/cpython/blob/master/Lib/http/server.py for
# the base class implementation and internal methods
class QuadplayHTTPRequestHandler(SimpleHTTPRequestHandler):
    # Directories that should be excluded from filesystem searches
    special_dir_regex = re.compile('(^|/)(journal|screenshots|metadata|backlot|graveyard)/', re.IGNORECASE)

    # Files that can be written or deleted by the IDE
    mutable_file_regex = re.compile(r'\.(json|xml|pyxl|png|pdf|yml|yaml|html|txt|md|tmx|mp3)$')

    # Files that should not print error messages to the script's
    # terminal if not found (there is no way to stop these from
    # printing errors to the *browser's* console).
    silent_404_file_regex = re.compile(r'(\.debug\.json|(^|/)label(64|128)\.png|favicon\.png)$')

    # Add custom headers
    def end_headers(self):
        # CORS:
        self.send_header('Access-Control-Allow-Origin', '*')

        # Required to enable high precision timer in Firefox and Chrome:
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')

        # Try to reduce overcaching
        self.send_header('Cache-Control', 'must-revalidate')
        SimpleHTTPRequestHandler.end_headers(self)

        
    def list_directory(self, path):
        # Prevent directory listing
        self.send_error(404, 'No permission to list directory (' + this_line_number() + ')')
        return None

    """
    # For debugging MIME types
    def guess_type(self, path):
        t = SimpleHTTPRequestHandler.guess_type(self, path)
        if path[-3:] == '.js': print("Guessed type", path, t)
        return t
        """

    # Returns False on security error
    def prepare_mutating_request(self):
        if args.serve:
           maybe_print('Refused POST/DELETE command while running with --serve')
           return False
        
        if self.client_address[0] != '127.0.0.1':
           maybe_print('Refused POST/DELETE command from non-local address', self.client_address[0])
           return False
       
        content_len = int(self.headers['Content-Length'])
        object = json.loads(self.rfile.read(content_len))

        request_token = object['token']
        if request_token != token:
            maybe_print('WARNING: Ignored request without proper token (expected ', token, '/ received ', request_token, ')')
            response = json.dumps('Bad token', separators = (',', ':'));
            self.send_response(403)
            self.send_header('Content-type', 'text/json')
            self.send_header('Content-length', len(response))
            self.end_headers()
            self.wfile.write(response.encode('utf8'))
            return False

        return object
    
    
    def do_DELETE(self):
        object = self.prepare_mutating_request()
        if not object: return
        path_parts = self.path.split('?')
        webpath = os.path.normpath(path_parts[0]).replace('\\', '/')

        maybe_print('DELETE', webpath)
        code = 200
        filename = remove_leading_slash(webpath)
        if not re.search(self.mutable_file_regex, filename) or not any([webpath.startswith(prefix) for prefix in webpath_allowlist]):
            maybe_print('WARNING: Ignored illegal request to delete file (' + this_line_number() + ')', filename)
            response_obj = 'Illegal'
            code = 403
        else:
            maybe_print('deleted file', filename)
            os.remove(filename)
        
        response = json.dumps('OK', separators = (',', ':'));
        self.send_response(code)
        self.send_header('Content-type', 'text/json')
        self.send_header('Content-length', len(response))
        self.end_headers()
        self.wfile.write(response.encode('utf8'))
        
    
    # Used for the IDE to write files
    def do_POST(self):
        global update_thread
        # maybe_print('\n\nReceived POST from ', self.client_address[0], '\n\n')

        object = self.prepare_mutating_request()
        if not object: return

        command = object['command']
        
        response_obj = None
        code = 201
        if command == 'write_file':
            webpath = object['url']
            filename = remove_leading_slash(webpath)
            encoding = object['encoding']
            contents = object['contents']            

            if not re.search(self.mutable_file_regex, filename) or not any([webpath.startswith(prefix) for prefix in webpath_allowlist]):
                maybe_print('WARNING: Ignored illegal request to write file (' + this_line_number() + ')', filename)
                if not re.search(self.mutable_file_regex, filename): maybe_print('  Legal file regex is', self.mutable_file_regex)
                if not any([webpath.startswith(prefix) for prefix in webpath_allowlist]): maybe_print('  Web path allow list is', webpath_allowlist)
                response_obj = 'Illegal'
                code = 403
            else:
                if encoding == 'binary':
                    # Contents are base64 encoded for the JSON transmission.
                    # Convert back to bytes
                    contents = base64.standard_b64decode(contents)
                    with open(filename, 'wb') as f: 
                        f.write(contents)
                        # See comment below about flushing
                        f.flush()
                        f.close()
                else:
                    with codecs.open(filename, 'w', encoding) as f: 
                        f.write(contents)
                        # Documentation says that closing the file flushes it, however
                        # on Windows we get race conditions where new files do not exist
                        # sometimes for a subsequent read even though they have been
                        # closed. So, we flush explicitly here, which either affects
                        # the timing just enough to make it succeed, or hopefully actually
                        # blocks until the file is written.
                        f.flush()
                        f.close()
                maybe_print('Wrote', encoding, 'file', filename)

                if isWindows:
                    # Because of the windows failure to flush files,
                    # there can be a race condition in the case of
                    # file renaming, where the client assumes the write
                    # has finished and then tries to read the same file.
                    # So, check here to ensure the file exists before returning:
                    max_iterations = 10
                    while not os.path.exists(filename) and max_iterations > 0:
                        time.sleep(0.02)
                        --max_iterations
                response_obj = 'OK'

        elif command == 'quit':
            # Used in nativeapp mode for the browser to tell the
            # (invisible) server to exit. Windows and Linux will
            # detect the browser closing, so this is only essential on
            # macOS where the menu option closes the TAB but leaves
            # the browser process still running.
            print('quadplay server terminated')

            # Hard exit, rather than raising an exception. Needed
            # because of threads
            if isWindows:
                os._exit(0)
            else:
                os.kill(os.getpid(), 9)
            
            response_obj = 'OK'
                
        elif command == 'open':
            app = object['app']
            filename = canonicalize_filepath(object['file'])
                   
            if app == '<finder>':
                show_file_in_filesystem(filename)
            elif isMacOS:
                cmd = 'open -a "' + app + '" "' + filename + '"'
                maybe_print(cmd)
                os.system(cmd)
            elif isWindows:
                cmd = '"' + app + '" "' + filename + '"'
                maybe_print(cmd)
                subprocess.call(cmd, shell=True)

            response_obj = 'OK'
            
        elif command == 'new_game':
            dir_name = object['dir_name']
            game_name = object['game_name']
            src_url = object['src_url']
            
            dst_path = my_games_filepath + '/' + dir_name

            # Convert src_url to src_path + src_filename
            src_path = re.sub(r'^https?://[^/]*/', '', src_url)
            src_path = re.sub(r'^quad://', quad_filepath, src_path)
            src_path = remove_leading_slash(os.path.normpath(src_path).replace('\\', '/'))
            if src_path.endswith('.game.json'):
                src_path = src_path.split('/')
                src_filename = src_path[-1]
                src_path = '/'.join(src_path[:-1])
            else:
                # Remove trailing slash
                if src_path[-1] == '/': src_path[:-1]
                src_filename = src_path.split('/')[-1] + '.game.json'

            #src_path = os.path.join(quad_filepath, 'examples/starter')
            #src_filename = 'starter.game.json'
            
            maybe_print('Created game', dir_name, 'at', dst_path)
            
            # Copy and rename files
            if os.path.exists(dst_path):
                code = 406
                response_obj = {'message': dst_path + ' already exists'}
            else:
                # Recursively copy directory
                shutil.copytree(src_path, dst_path, ignore = shutil.ignore_patterns('.DS_Store', '*~', '#*'))
                #for filename in ['label64.png', 'label128.png', 'Play.pyxl']:
                #    shutil.copyfile(os.path.join(starter_path, filename), os.path.join(dst_path, filename))
                shutil.copyfile(os.path.join(quad_filepath, '.gitignore'), os.path.join(dst_path, '.gitignore'))

                # Parse the starter game
                game_json = workjson.load(os.path.join(src_path, src_filename))

                # Change the title
                game_json['title'] = game_name
                game_json['screenshot_tag'] = game_name

                # Save the new game
                with open(os.path.join(dst_path, dir_name + '.game.json'), 'wt', encoding='utf8') as f:
                    f.write(workjson.dumps(game_json, indent=4))

                # Delete the old starter game file
                os.remove(os.path.join(dst_path, src_filename))
                
                response_obj = {'game': '/' + dst_path + '/'}
                
        elif command == 'update':
            maybe_print('Updating quadplay...')
            if not update_thread or (update_thread.get_status() != 'Running'):
                update_thread = UpdateThread()
                update_thread.start()
                response_obj = 'OK'
            else:
                maybe_print('Update already in progress.')
                response_obj = 'Update already in progress.'
            
        elif command == 'export_game':
            target = object.get('target', 'standalone')
            
            # Get the game path from the request
            game_path = object.get('game_path', '')
            if not game_path:
                response_obj = {'error': 'No game path provided'}
                code = 400
            else:
                # Translate web path to filesystem path
                game_path = self.translate_path(game_path)
                
                if not os.path.exists(game_path):
                    response_obj = {'error': f'Game file not found: {game_path}'}
                    code = 404
                else:
                    try:
                        # Set up export arguments
                        args = types.SimpleNamespace()
                        args.game = game_path 
                        args.quadpath = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
                        args.noquad = False
                        args.force = True
                        args.dry_run = False
                        args.outpath = None
                        
                        # Set zipfile to be in the same directory as the game.json
                        game_dir = os.path.dirname(game_path)
                        args.zipfile = os.path.join(game_dir, os.path.basename(game_path).replace('.game.json', '.zip'))
                        
                        # Import and run the quadplay export function
                        from export import export
                        export(args)
                        
                        # Show the zipfile in the file browser
                        show_file_in_filesystem(args.zipfile)
                        
                        # Set success response
                        response_obj = {'status': 'success'}
                        code = 200
                        
                    except Exception as e:
                        response_obj = {'error': str(e)}
                        code = 500

            response = json.dumps(response_obj, separators = (',', ':'));
            self.send_response(code)
            self.send_header('Content-type', 'text/json')
            self.send_header('Content-length', len(response))
            self.end_headers()
            self.wfile.write(response.encode('utf8'))

        response = json.dumps(response_obj, separators = (',', ':'));
        self.send_response(code)
        self.send_header('Content-type', 'text/json')
        self.send_header('Content-length', len(response))
        self.end_headers()
        self.wfile.write(response.encode('utf8'))

        
    def do_GET(self):        
        # Remove the query and collapse any '..' in the path
        path_parts = self.path.split('?')
        webpath = os.path.normpath(path_parts[0]).replace('\\', '/')
        query = path_parts[1] if len(path_parts) > 1 else ''

        #print('-----------------------------')
        #print('GET ' + path_parts[0])
        #print(' webpath = ' + webpath)

        # Security: Check if path has a prefix in webpath_allowlist
        if (not any([webpath == ignore for ignore in ['/favicon.ico', '/apple-touch-icon-precomposed.png', '/apple-touch-icon.png', '/apple-touch-icon-120x120-precomposed.png', '/apple-touch-icon-120x120.png']]) and
            not any([webpath.startswith(prefix) for prefix in webpath_allowlist])):
            self.send_error(403, 'Illegal webpath (' + this_line_number() + '): ' + webpath)
            return

        filepath = remove_leading_slash(webpath)
        self.path = filepath

        if webpath in [config_query_webpath, asset_query_webpath, game_query_webpath, doc_query_webpath, script_query_webpath, update_progress_query_webpath]:
            response_obj = {}

            # default to "OK"
            response_code = 200
            
            if webpath == update_progress_query_webpath:
                if update_thread:
                    status = update_thread.get_status()
                    response_obj['status'] = status
                    response_obj['done'] = (status != 'Running')
                    response_obj['restartServer'] = (status == 'Done. Restart server.')
                else:
                    response_obj['status'] = 'No update in progress.'
                    response_obj['restartServer'] = False
                    response_obj['done'] = True
                    
            elif webpath == config_query_webpath:
                if not args.kiosk: response_obj['IDE_USER'] = os.environ['USERNAME' if isWindows else 'USER']
                response_obj['rootPath'] = server_root_filepath
                response_obj['hasFinder'] = isWindows or isMacOS
                response_obj['hasGit'] = hasGit

                if isWindows or isMacOS:
                    applications = []
                    response_obj['applications'] = applications
                    potential_applications = workjson.load(os.path.join(quad_filepath, 'console/external-applications.json'))['Windows' if isWindows else 'macOS']
                    for app in potential_applications:
                        for path in app['paths']:
                            path = canonicalize_filepath(os.path.expandvars(os.path.expanduser(path)))
                            if os.path.exists(path):
                                # Found this app
                                applications.append({'name': app['name'], 'path': path, 'types': app['types']})
                                #print('FOUND', path)
                                break
                            #else:
                            #    print('Did not find', path)
                            
            elif webpath == script_query_webpath:
                aux_webpath = query[query.index('=') + 1:]
                # Security: check if aux_webpath has a prefix in webpath_allowlist
                if not any([aux_webpath.startswith(prefix) for prefix in webpath_allowlist]):
                    self.send_error(403, 'Illegal webpath (' + this_line_number() + '): ' + aux_webpath)
                    return

                # List the pyxl files
                aux_filepath = remove_leading_slash(aux_webpath)
                response_obj = glob.glob(aux_filepath + '**/*.pyxl', recursive=True)

                # Remove anything in a magic directory
                response_obj = [f for f in response_obj if not self.special_dir_regex.search(f)]
                
                # Sort all files
                response_obj.sort()

                # List additional files from the built-in scripts folder
                response_obj += ['quad://' + f[len(quad_filepath):] for f in sorted(glob.glob(quad_filepath + 'scripts/*.pyxl'))]
                    
                # Fix slashes on windows
                if isWindows: response_obj = [f.replace('\\', '/') for f in response_obj]

            elif webpath == doc_query_webpath:
                aux_webpath = query[query.index('=') + 1:]

                # Security: check if aux_webpath has a prefix in webpath_allowlist
                if not any([aux_webpath.startswith(prefix) for prefix in webpath_allowlist]):
                    self.send_error(403, 'Illegal webpath: (' + this_line_number() + ')' + aux_webpath)
                    return

                aux_filepath = remove_leading_slash(aux_webpath)
                # List the files
                response_obj =  glob.glob(aux_filepath + '**/*.html', recursive=True)
                response_obj += glob.glob(aux_filepath + '**/*.md',   recursive=True)
                response_obj += glob.glob(aux_filepath + '**/*.pdf',  recursive=True)
                response_obj += glob.glob(aux_filepath + '**/*.txt',  recursive=True)

                # Do not remove any magic directory files; we want journals and such in this list
                
                # Sort all files
                response_obj.sort()
                    
                # Fix slashes on windows
                if isWindows: response_obj = [f.replace('\\', '/') for f in response_obj]
                
            elif webpath == asset_query_webpath:
                aux_webpath = query[query.index('=') + 1:]

                # Security: check if aux_webpath has a prefix in webpath_allowlist
                if not any([aux_webpath.startswith(prefix) for prefix in webpath_allowlist]):
                    self.send_error(403, 'Illegal webpath: (' + this_line_number() + ')' + aux_webpath)
                    return
                
                # Raw files to exclude because they are already in use. Exclude
                # the files from quadplay's own metadata automatically.
                exclude_table = {}
                for f in ['label64.png', 'label128.png', 'preview.png']:
                    exclude_table[remove_leading_slash(aux_webpath) + f] = True

                # Search (quad_filepath | aux_webpath) + type + 's/*.' + type + '.json'
                asset_type_array = ['font', 'sprite', 'sound', 'map', 'data']
                raw_extension_table = {'sprite': 'png', 'font': 'png', 'sound': 'mp3', 'map': 'tmx'}
                source_extension_array = ['kra', 'psd', 'ase', 'aseprite']

                # Get json assets from the game directory and build the exclude list.
                # This must be done before iterating for raw assets because multiple
                # asset types use the same type of raw file (e.g., PNG).
                for t in asset_type_array:
                    # Get the json files from the game directory
                    response_obj[t] = glob.glob(remove_leading_slash(aux_webpath + '**/*.' + t + '.json'), recursive=True)

                    # Look in each of the files for the URLs of raw files to exclude
                    for file in response_obj[t]:
                        try:
                            tmp = workjson.load(file)
                            if 'url' in tmp:
                                exclude_table[remove_leading_slash(aux_webpath) + tmp['url']] = True
                        except:
                            maybe_print('Warning: Could not parse ' + file)

                # Art source files, pre-export. These will be used by
                # the IDE to set up source_url when performing import
                # of a PNG
                response_obj['source'] = []
                for source_extension in source_extension_array:
                    raw_files = glob.glob(remove_leading_slash(aux_webpath + '**/*.' + source_extension), recursive=True)

                    # Remove anything in a magic directory
                    response_obj['source'] += [f for f in raw_files if not self.special_dir_regex.search(f)]

                # Sort
                response_obj['source'] = sorted(response_obj['source'])

                # Fix slashes on windows
                if isWindows: response_obj['source'] = [f.replace('\\', '/') for f in response_obj['source']]
                
                # Get additional raw files from the game directory and
                # json assets from the quadplay directory.
                for t in asset_type_array:
                    # Get raw files
                    if t != 'data':
                        raw_files = glob.glob(remove_leading_slash(aux_webpath + '**/*.' + raw_extension_table[t]), recursive=True)
                    else:
                        raw_files = []

                    # Remove anything that is in exclude_table from raw_files 
                    raw_files = [f for f in raw_files if not f in exclude_table]
                    
                    # Append these raw files
                    response_obj[t] += raw_files

                    # Remove anything in a magic directory
                    response_obj[t] = [f for f in response_obj[t] if not self.special_dir_regex.search(f)]

                    # Sort
                    response_obj[t] = sorted(response_obj[t])

                    # Get the json files from the quadplay directory,
                    # sort, and append them to the list
                    response_obj[t] += ['quad://' + f[len(quad_filepath):] for f in sorted(glob.glob(quad_filepath + t + ('s' if t != 'data' else '') + '/*.' + t + '.json'))]
                    
                    # Fix slashes on windows
                    if isWindows: response_obj[t] = [f.replace('\\', '/') for f in response_obj[t]]

            elif webpath == game_query_webpath:

                # Detect games with the same name as the folder
                redundant_pattern = re.compile(r'(?P<name>/[^/]+)(?P=name)\.game\.json$')
                set = {'examples' : quad_filepath + 'examples',
                       'builtins' : quad_filepath + 'games',
                       'mine'     : my_games_filepath}

                # For alpha testers and internal development
                if os.path.exists(quad_filepath + '_alpha'):
                    set['alpha'] = quad_filepath + '_alpha'
                    set['tests'] = quad_filepath + '_tests'

                copied_properties = ['developer', 'version', 'min_players', 'max_players', 'cooperative', 'competitive', 'achievements', 'highscores']

                for key, path in set.items():
                    # Do not change case on Windows (because this will be part of the json file that is read
                    # on multiple platforms) but *do* fix slashes
                    list = [{'url': path.replace('\\', '/'), 'title': 'TBD'} for path in sorted(glob.glob(path + '/**/*.game.json', recursive=True))]
                    for entry in list:
                        path = entry['url']

                        if key == 'mine':
                            # Make relative to the web root
                            entry['url'] = '/' + entry['url']
                        else:
                            # Shorten built-ins to quad://
                            entry['url'] = 'quad://' + path[len(quad_filepath):]

                        # Shorten games with redundant names to just the directory
                        entry['url'] = redundant_pattern.sub(r'\1/', entry['url'])
                        # Fetch the titles
                        with open(path, 'rt', encoding='utf8') as f:
                            game = workjson.loads(f.read())
                            entry['description'] = game['description'] if 'description' in game else ''
                            entry['title'] = game['title']
                            for prop in copied_properties:
                                if prop in game: entry[prop] = game[prop]
                                    
                    response_obj[key] = list

            response = json.dumps(response_obj, separators = (',', ':'))
            self.send_response(response_code)
            self.send_header('Content-type', 'text/json')
            self.send_header('Content-length', len(response))
            self.end_headers()
            self.wfile.write(response.encode('utf8'))
            
        elif webpath.endswith('/_git'):
            response_code = 200
            response = '-1\n'

            git_cmd = urllib.parse.unquote(query)
            
            if not hasGit:
                # Should not have issued a git command
                maybe_print('Prevented: git ' + git_cmd)
                response_code = 404
            else:
                # For security, verify that this is a permitted command
                # and has nothing else packed into it
                if git_cmd.split(' ')[0] in ['pull', 'push', 'status', 'add', 'commit', 'merge', 'reset', 'fetch'] and not ('&' in git_cmd or '|' in git_cmd or ';' in git_cmd):
                    # Run the git command
                    response = '0\n'

                    file_path = os.path.dirname(remove_leading_slash(webpath))
                    git_cmd = 'git -C ' + file_path + ' ' + git_cmd
                  
                    maybe_print(git_cmd)

                    # Build the command capturing stderr so it doesn't spam the console.
                    # 
                    # No need to restore the directory after the command because
                    # run_shell_command makes a new shell
                    
                    if not isWindows:
                        # Send stderr to stdout
                        git_cmd = git_cmd + ' 2>&1'
                        
                    (response, return_code) = run_shell_command(git_cmd, True, True)
                    response = str(return_code) + '\n' + response
                    
                else:
                    # Illegal command
                    maybe_print('Rejected illegal git command: git ' + git_cmd)
                    # "Forbidden" error code
                    response_code = 403
            
            self.send_response(response_code)
            self.send_header('Content-type', 'text/plain')
            self.send_header('Content-length', len(response))
            self.end_headers()
            self.wfile.write(response.encode('utf8'))
            
        elif re.search(self.silent_404_file_regex, webpath) and not os.path.exists(filepath):
            # Check to see if this file does not exist. If it does
            # not, return the 404 error but do not print to the terminal
            self.send_response(404)
            self.send_header('Content-type', 'text/json')
            self.send_header('Content-length', 0)
            self.end_headers()
        else:
            # Serve the file
            f = self.send_head()
            if f:
               try:
                   self.copyfile(f, self.wfile)
               except BrokenPipeError:
                   maybe_print('Broken pipe while loading', filepath)
               finally:
                   f.close()

                   
    def log_request(self, code = '-', size = '-'):
        # Overridden to not show all requests
        #self.log_message('"%s" %s %s', self.requestline, str(code), str(size))
        pass

    
    def log_error(self, format, *args):
        # Overridden to allow a debugging point
        self.log_message(format, *args)

        
    def translate_path(self, path):
        if path == '/favicon.ico':
            # Browsers sometimes ask for the icon from this
            # location. Send them to the quadplay directory instead
            return quad_filepath + '/console/icons/favicon.ico'

        elif path == '/apple-touch-icon-precomposed.png' or path == '/apple-touch-icon.png':
            # Safari asks for the icon via this path
            return quad_filepath + '/console/icons/favicon-64x64.png'

        elif path == '/apple-touch-icon-120x120-precomposed.png' or path == '/apple-touch-icon-120x120.png':
            # Safari asks for the icon via this path
            return quad_filepath + '/console/icons/favicon-120x120.png'

        elif isWindows and server_root_filepath == '':
            # Need the whole path, since the "cwd" is wrong
            return self.path.split('?')[0]
        else:
            # Intentionally use Python 2 super syntax for potential
            # backward compatibility
            result = SimpleHTTPRequestHandler.translate_path(self, path)
            return result


"""QuadplayHTTPRequestHandler.extensions_map.update({
    '.manifest': 'text/cache-manifest',
	'.html': 'text/html',
    '.png': 'image/png',
	'.jpg': 'image/jpg',
	'.svg':	'image/svg+xml',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.pyxl': 'text/plain',
	'.css':	'text/css',
    '.mp3': 'audio/mpeg',
    '.wasm': 'application/wasm',
	'.js':'application/javascript'
})"""



if isWindows and args.gamepath:
    # Make drive letters canonical
    if args.gamepath[1] == ':':
        args.gamepath = args.gamepath[0].upper() + args.gamepath[1:]

        
# Makes a path relative to the server_root_filepath, and thus "absolute"
# for the web server root (not for the filesystem)
def platform_www_abspath(p):
    if isWindows:
        p = p[len(server_root_filepath):]
        if not p.endswith('.game.json'): p = os.path.join(p, '')
        t = os.path.normcase(p).replace('\\', '/')
        if t[0] != '/': t = '/' + t
        return t
    else:
        if server_root_filepath != '/':
            p = p[len(server_root_filepath)+1:]
            
        if p == '':
            return ''
        elif p.endswith('.game.json'):
            return os.path.join('/', p)            
        else:
            return os.path.join('/', p, '')


# Process paths at top level so that they can be inherited by ThreadingHTTPServer
quad_filepath = canonicalize_filepath(os.path.join(os.path.dirname(__file__), '..'))
token_absfilepath = os.path.join(quad_filepath, 'tools/token.txt')

# Compute the serving paths
game_filepath = canonicalize_filepath(args.gamepath)
if game_filepath.endswith('.game.json'): game_filepath = os.path.dirname(game_filepath)
webpath_allowlist = [quad_filepath, game_filepath, my_games_filepath]
       
# Common ancestor
server_root_filepath = os.path.dirname(os.path.commonprefix([os.path.join(p, '') for p in webpath_allowlist]))

# Strip the common prefix
webpath_allowlist = [platform_www_abspath(p) for p in webpath_allowlist]
my_games_filepath = remove_leading_slash(my_games_filepath[len(server_root_filepath):])

# Remove trailing slash
asset_query_webpath = webpath_allowlist[0]
if len(asset_query_webpath) > 0 and asset_query_webpath[-1] == '/': asset_query_webpath = asset_query_webpath[:-1]
game_query_webpath = asset_query_webpath + '/console/games.json'
config_query_webpath = asset_query_webpath + '/console/_config.json'
script_query_webpath = asset_query_webpath + '/console/_scripts.json'
update_progress_query_webpath = asset_query_webpath + '/console/_update_progress.json'
doc_query_webpath = asset_query_webpath + '/console/_docs.json'
quad_filepath = remove_leading_slash(webpath_allowlist[0])
asset_query_webpath += '/console/_assets.json'

maybe_print = ignore if args.quiet else print
   

if False:
    # Debug paths
    maybe_print("\nserver_root_filepath   = '" + server_root_filepath + "'")
    maybe_print("quad_filepath          = '" + quad_filepath + "'")
    maybe_print("my_games_filepath      = '" + my_games_filepath + "'")
    maybe_print("asset_query_webpath    = '" + asset_query_webpath + "'")
    maybe_print("script_query_webpath   = '" + script_query_webpath + "'")
    maybe_print("doc_query_webpath      = '" + doc_query_webpath + "'")
    maybe_print("game_query_webpath     = '" + game_query_webpath + "'")
    maybe_print("config_query_webpath   = '" + config_query_webpath + "'")
    maybe_print('webpath_allowlist      = ', webpath_allowlist, '\n')
    sys.exit()

# SSL support doesn't work yet due to self-signed certificate problems
useSSL = False

# Runs in a different process
def launchServer(post_token):
    global httpd, args, server_root_filepath, token

    # Assign back to the global token. We have to do this because
    # Python reinitializes all globals
    token = post_token
    
    # Serve from the common directory, unless the common directory
    # is the filesystem root and we're on windows where that cannot
    # be the cwd
    old_path = os.getcwd()
    if not isWindows or server_root_filepath != '':
        os.chdir(server_root_filepath)

    attempts = 0
    while attempts < 2:
        try:
            attempts += 1
            # '' = 0.0.0.0 = all local IP addresses, needed for
            # supporting devices other than just localhost
            server_address = ('' if args.serve else 'localhost', args.port)
            httpd = QuadplayHTTPServer(server_address, QuadplayHTTPRequestHandler)
            
            if useSSL:
                # This path is never used in the current implementation
                httpd.socket = ssl.wrap_socket(httpd.socket, 
                                               keyfile='console/ssl/local-key.pem', 
                                               certfile='console/ssl/local-cert.pem',
                                               do_handshake_on_connect=False,
                                               server_side=True)
            httpd.serve_forever()
            os.chdir(old_path)
            return
            
        except OSError as e:
            if attempts < 2 and e.errno == 48:
                print('Cleaning up previous quadplay server instance...')
                
                # Read the old token
                with open(token_absfilepath, 'r') as file: old_token = file.readline()

                # Send a QUIT command via POST
                try:
                    urllib.request.urlopen(urllib.request.Request(
                        'http://localhost:' + str(server_address[1]) + '/',
                        bytes('{"command":"quit","token":"' + old_token + '"}', 'utf-8'),
                        {'Content-Type': 'application/json;charset=UTF-8'}))
                except:
                    # The server on the other side will terminate immediately
                    # (or, it might be unresponsive!)
                    pass

                # Wait for the OS to clean up the listener socket
                time.sleep(0.1)
                                       
                # The loop will now make a second attempt
            else:
                maybe_print(e)
                maybe_print('Not starting a local server, since one is already running.');
                os.chdir(old_path)


#######################################################################
        
def main():
    global webpath_allowlist, server_root_filepath, token

    token = "%0.7X" % random.randrange(0, 0x10000000)

    if not args.quiet:
        if isWindows: os.system('color')
        banner = ['',
            '\033[91m                      ╷       ╷                    ',
            '\033[95m╭───╮ ╷   ╷  ───╮ ╭── │ ╭───╮ │   ───╮ ╷   ╷   ▒▒  ',
            '\033[94m│   │ │   │ ╭── │ │   │ │   │ │  ╭── │ │   │ ▒▒  ▒▒',
            '\033[96m╰── │ ╰───┘ ╰───╯ ╰───╯ │ ──╯ ╰─ ╰───╯ ╰── │   ▒▒  ',
            '\033[37m    ╵                   ╵                ──╯       ','\033[0m']
        
        for line in banner:
            maybe_print('         ' + line)

    maybe_print('_________________________________________________________________________\n')
    maybe_print('quadplay version ' + installed_quadplay_version['text'] + ' from ' + quadplay_origin + '\n')

    myip = '127.0.0.1'
    if args.serve:
        try:
            maybe_print('Getting IP address...')
            myip = ''

            # just try this first on mac because the other approaches fail so frequently
            if isMacOS:
               myip = (os.popen('ipconfig getifaddr en0').read().strip() or
                       os.popen('ipconfig getifaddr en1').read().strip())
            if not myip: myip = socket.gethostbyname(socket.gethostname())
        except:
            if isMacOS:
                # The above can fail apparently randomly on MacOS (https://bugs.python.org/issue35164)
                # and that has happened to us. This is a workaround:
                maybe_print('gethostbyname failed due to a known MacOS internal error. Falling back to\nipconfig...')
                
                myip = os.popen('ipconfig getifaddr en0').read().strip()
                if not myip:
                   maybe_print('Could not find en0. Looking for en1...')
                   myip = os.popen('ipconfig getifaddr en1').read().strip()
                
                if not myip:
                    maybe_print('WARNING: ipconfig could not find a valid en0 or en1 adapter. Server IP address is unknown.')
                    myip = '127.0.0.1'
                else:
                    maybe_print('WARNING: gethostbyname unexpectedly failed. Server IP address is unknown.')
                    myip = '127.0.0.1'
                    
    url = 'http' + ('s' if useSSL else '')+ '://' + myip + ':' + str(args.port)
    if not quad_filepath or quad_filepath[0] != '/': url += '/'
    url += os.path.join(quad_filepath, 'console/app.html?fastReload=1&token=' + token)

    if args.nativeapp: url += '&nativeapp=1'
    if not args.noupdatecheck and not args.kiosk:
        if quadplay_origin == 'development git clone':
            url += '&update=dev'
        elif quadplay_origin == 'git clone':
            url += '&update=git'
        else:
            url += '&update=1'

    if args.nosleep:
        url += '&nosleep=1'
            
    # Sanitized username
    url += '&name=' + re.compile('[^A-Za-z0-9_]').sub('', getpass.getuser())
    
    if args.kiosk:
        url += '&mode=Maximal&kiosk=1'
    elif args.play:
        url += '&mode=Windowed'
    else:
        url += '&IDE=1'

    if args.offline:
        url += '&offline=1'
        

    if args.gamepath != '':
        t = args.gamepath
        if not t.startswith('http://') and not t.startswith('quad://'):
            t = platform_www_abspath(os.path.abspath(t))
            if t and not isWindows and t[0] != '/': t = '/' + t
        url += '&game=' + t

    if args.serve:
        maybe_print('Operating in --serve mode. Your firewall may need to be configured to load on other devices.\n')
        if isMacOS:
            maybe_print('Opening macOS firewall settings')
            os.system('open "x-apple.systempreferences:com.apple.preference.network"')

    url += '&quadserver=1'

    maybe_print('\nServing from:\n\n   ' + url + '\n')
    
    # Run from the quadplay path
    maybe_print('   quad://  = ' + os.path.join(server_root_filepath, quad_filepath))
    maybe_print('   My games = ' + os.path.join(server_root_filepath, my_games_filepath) + '/')
    maybe_print('   cwd      = ' + remove_trailing_slash(server_root_filepath))
    maybe_print('   args     = ' + str(args), '\n')

    if not args.nativeapp:
        try:
            # For kbhit()
            import msvcrt
        except ImportError:
            import termios, atexit, select
            stdinFd = sys.stdin.fileno()
            new_term = termios.tcgetattr(stdinFd)
            old_term = termios.tcgetattr(stdinFd)
            def set_normal_term():
                termios.tcsetattr(stdinFd, termios.TCSAFLUSH, old_term)

            # New terminal setting unbuffered
            new_term[3] = (new_term[3] & ~termios.ICANON & ~termios.ECHO)
            termios.tcsetattr(stdinFd, termios.TCSAFLUSH, new_term)

            # Support normal-terminal reset at exit
            atexit.register(set_normal_term)

        # Platform independent keyboard key press detection
        def kbhit():
            if isWindows:
                return msvcrt.kbhit()
            else:
                dr, dw, de = select.select([sys.stdin], [], [], 0)
                return dr != []

    httpd = 0

    serverThread = multiprocessing.Process(target=launchServer, args=[token])
    maybe_print('Starting local server thread...')
    serverThread.start()
    time.sleep(1.5)

    if not serverThread.is_alive():
        print('Could not start quadplay server.')
        sys.exit(2)
    else:
        # Store the token so that other servers can force-quit this one
        with open(token_absfilepath, 'wt') as file: file.write(token)
        
    browser_filepath = None
    
    # Try to find Edge, then Chromium if they exist because those
    # are the fastest quadplay browsers and support extra kiosk
    # features.
    if isWindows:
        import winreg
        for p in ['MSEdgeHTM', 'ChromeHTML', 'BraveHTML']:
            try:
                command = winreg.QueryValueEx(winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, p + "\\shell\\open\\command", 0, winreg.KEY_READ), "")[0]
                browser_filepath = re.search("\"(.*?)\"", command).group(1)
                if os.path.exists(browser_filepath):
                    break
                else:
                    browser_filepath = None
            except:
                pass
    else:
        if isMacOS:
            browser_list = ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser']
        else: # Linux
            browser_list = ['/usr/bin/chromium-browser']
            
        for p in browser_list:
            if os.path.exists(p):
                browser_filepath = p
                break
        
    # Require quotes around URLs so that the shell does not interpret
    # "&" in a URL as a shell option to run in another thread
    #
    # The --start-fullscreen argument works for Edge and Chrome on
    # Windows and macOS. There is no direct command line way to launch
    # Safari or Firefox in fullscreen mode, or to launch in fullscreen
    # using xdg-open on Linux.
    
    browser_command = ''
    
    # Monitor the browser and close the server when it exits
    auto_close_server = False

    # We must force a fake user data directory to prevent
    # the chromium script from sharing an existing session, which would cause the
    # call() below to not block: https://askubuntu.com/questions/35392/how-to-launch-a-new-instance-of-google-chrome-from-the-command-line
    # This is also intended to keep processes clear of each other when running multiple instances of quadplay.
    chromium_nativeapp_args = ' --user-data-dir="' + os.path.join(os.path.expanduser('~'), 'quadplay_session') + '" --no-user-gesture-required '
    quadplay_session = os.path.join(os.path.expanduser('~'), 'quadplay_session')
    if not os.path.exists(quadplay_session): os.mkdir(quadplay_session)

    if args.gamepath == '':
        maybe_print('\nLoading default game. You can supply the URL or local relative path to your game on\nthe command line, for example "tools/quadplay-server foo/mygame", to load it directly.\n')

    if isWindows:
        if browser_filepath and args.nativeapp:
            # Use Chrome/Edge if available, in order to present more
            # as a native app.  On recent Windows 10, we can count on
            # Edge being present.
            #
            # Because of the way that windows CMD processes quotes in
            # the command line, it is necessary to put double quotes
            # around the ENTIRE line as well as around the individual
            # arguments when using os.system(), but not for
            # subprocess.call():
            #
            # https://superuser.com/questions/238810/problem-with-quotes-around-file-names-in-windows-command-shell
            browser_command = '"' + browser_filepath + '" -app="' + url + '" ' + chromium_nativeapp_args + (' --start-fullscreen' if args.kiosk else '')
            auto_close_server = True
        else:
            browser_command = 'start "quadplay" "' + url + '"' + (' --start-fullscreen' if args.kiosk else '')
    elif isMacOS:
        if browser_filepath and args.nativeapp:
            auto_close_server = True
            browser_command = '"' + browser_filepath + '" ' + chromium_nativeapp_args + ' -app="' + url + '" ' + (' --start-fullscreen' if args.kiosk else '')
        else:
            browser_command = 'open "' + url + '" ' + (' --args --start-fullscreen' if args.kiosk else '')
    else: # Linux
        if browser_filepath and args.nativeapp:
            browser_command = browser_filepath + ' -app="' + url + '" ' + chromium_nativeapp_args + (' --start-fullscreen' if args.kiosk else '')
            auto_close_server = True
        else:
            browser_command = 'xdg-open "' + url + '"'


    
    if auto_close_server:
        # Block until the client terminates, but do so in a way that
        # we can interrupt if the server self-terminates first on
        # macOS.
        maybe_print('Launching IDE via ' + browser_command)
        client = subprocess.Popen(shlex.split(browser_command), stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL if args.quiet else None)

        # If another browser process is already running (on Edge Chromium, at least), then
        # the client process may terminate instantly because it is a zygote. Require an explicit 
        # close message in this case, which quadplay will send to the server.
        auto_close_with_client = False
        while (not auto_close_with_client or client.poll() == None) and serverThread.is_alive():
            time.sleep(0.2)

        if serverThread.is_alive():
            maybe_print('Client IDE process auto terminated')
        else:
            maybe_print('Server thread auto terminated')
        
        # Kill the client if it didn't already terminate
        client.terminate()
    else:
        # On Raspberry Pi OS, the launch call will block if run directly
        # through os.system.
        browser_thread = multiprocessing.Process(target=os.system, args=(browser_command,))
        browser_thread.start()
        
        # Wait for key stroke
        maybe_print('\n**Press any key to terminate the server when done**\n')
        while not kbhit() and serverThread.is_alive(): time.sleep(0.25)
    
    maybe_print('\nShutting down...')

    # Attempt to gracefully shut down
    if httpd: threading.Thread(target=lambda : httpd.shutdown())
    time.sleep(1)
    serverThread.terminate()

    return 0

if __name__ == "__main__":
    sys.exit(main())

def show_file_in_filesystem(filepath):
    """Show a file in the system's file explorer.
    
    Args:
        filepath (str): Absolute path to the file to show
    """
    if sys.platform == 'darwin':  # macOS
        subprocess.run(['open', '-R', filepath])
    elif sys.platform == 'win32':  # Windows
        subprocess.run(['explorer', '/select,', filepath])
    else:  # Linux
        subprocess.run(['xdg-open', os.path.dirname(filepath)])
