" Vim syntax file
" Language:	Quadplay (pyxlscript)
" Maintainer:	Stephan Steinbach 
" Last Change:	2019 Jul 04
" Credits:	Based on python.vim by Neil Schemenauer <nas@pyxlscript.ca> + the
"           emacs file by Morgan McGuire.
"
" For version 5.x: Clear all syntax items.
" For version 6.x: Quit when a syntax file was already loaded.
if version < 600
  syntax clear
elseif exists("b:current_syntax")
  finish
endif

" @TODO: the comment after a comment should be colored like a comment

" We need nocompatible mode in order to continue lines with backslashes.
" Original setting will be restored.
let s:cpo_save = &cpo
set cpo&vim

" Capture the modes and separators
syn match pyxlscriptModeLine '^init$\n^─\+$\|^enter$\n^─\+$\|^frame$\n^─\+$\|^leave$\n^─\+$' 

syn keyword pyxlscriptStatement let const in return break continue ∊ ∈
syn keyword pyxlscriptLiteral ½ ⅓ ⅔ ¼ ¾ ⅕ ⅖ ⅗ ⅘ ⅙ ⅐ ⅛ ⅑ ⅒ ° deg ε π nan ∅ SCREEN_SIZE pi epsilon infinity nil
syn keyword pyxlscriptBoolean true false
syn keyword pyxlscriptBuiltIn add_frame_hook remove_frame_hook draw_sprite draw_text draw_tri text_width get_transform get_clip rotation_sign set_transform unparse format_number lowercase uppercase xy xyz draw_map stop_audio play_sound game_frames mode_frames now game_frames mode_frames gray rgb rgba hsv hsva call abs acos atan get_previous_mode get_mode sign get_map_sprite get_map_pixel_color get_map_sprite_by_draw_coord get_map_pixel_color_by_draw_coord get_sprite_pixel_color sign_nonzero asin cos clamp hash lerp loop min max mid noise oscillate overlap pow random_value random_integer random ξ sgn sqrt sin set_random_seed tan clone copy cross direction dot equivalent magnitude max_component min_component xy xyz fast_remove_key find keys remove_key size substring sort resize push pop remove_values pad joy debug_print draw_disk entity_simulate set_transform reset_transform reset_clip set_clip draw_line draw_previous_mode draw_point make_entity overlaps entity_add_child entity_update_children draw_entity intersect_clip draw_sprite_corner_rect draw_rect set_background get_background assert debug_watch ray_intersect draw_bounds any_button_press get_sound_status set_pitch set_volume set_pan set_loop

syn match pyxlscriptColor "#[0-9A-Fa-f]+"

syn keyword pyxlscriptStatement	def nextgroup=pyxlscriptDef skipwhite
syn keyword pyxlscriptStatement return local preserving_transform with set_mode reset_game launch_game quit_game push_mode pop_mode because
syn keyword pyxlscriptConditional if else then
syn keyword pyxlscriptRepeat	for while until
syn keyword pyxlscriptOperator	and in is not or

" Decorators (new in pyxlscript 2.4)
" The zero-length non-grouping match before the function name is
" extremely important in pyxlscriptDef.  Without it, everything is
" interpreted as a function inside the contained environment of
" doctests.
" A dot must be allowed because of @MyClass.myfunc decorators.
syn match   pyxlscriptDef
      \ "\%(\%(def\s\)\s*\)\@<=\h\%(\w\|\.\)*" contained

syn match   pyxlscriptComment	"//.*$" contains=pyxlscriptTodo,@Spell
syn keyword pyxlscriptTodo		FIXME NOTE NOTES TODO XXX contained

syn region  pyxlscriptString
      \ start=+[uU]\=\z(['"]\)+ end="\z1" skip="\\\\\|\\\z1"
      \ contains=pyxlscriptEscape,@Spell
syn region  pyxlscriptString
      \ start=+[uU]\=\z('''\|"""\)+ end="\z1" keepend
      \ contains=pyxlscriptEscape,pyxlscriptSpaceError,pyxlscriptDoctest,@Spell
syn region  pyxlscriptRawString
      \ start=+[uU]\=[rR]\z(['"]\)+ end="\z1" skip="\\\\\|\\\z1"
      \ contains=@Spell
syn region  pyxlscriptRawString
      \ start=+[uU]\=[rR]\z('''\|"""\)+ end="\z1" keepend
      \ contains=pyxlscriptSpaceError,pyxlscriptDoctest,@Spell

syn match   pyxlscriptEscape	+\\[abfnrtv'"\\]+ contained
syn match   pyxlscriptEscape	"\\\o\{1,3}" contained
syn match   pyxlscriptEscape	"\\x\x\{2}" contained
syn match   pyxlscriptEscape	"\%(\\u\x\{4}\|\\U\x\{8}\)" contained
" pyxlscript allows case-insensitive Unicode IDs: http://www.unicode.org/charts/
syn match   pyxlscriptEscape	"\\N{.\{-}}" contained
syn match   pyxlscriptEscape	"\\$"

" It is very important to understand all details before changing the
" regular expressions below or their order.
" The word boundaries are *not* the floating-point number boundaries
" because of a possible leading or trailing decimal point.
" The expressions below ensure that all valid number literals are
" highlighted, and invalid number literals are not.  For example,
"
" - a decimal point in '4.' at the end of a line is highlighted,
" - a second dot in 1.0.0 is not highlighted,
" - 08 is not highlighted,
" - 08e0 or 08j are highlighted,
"
" and so on, as specified in the 'pyxlscript Language Reference'.
" http://docs.pyxlscript.org/reference/lexical_analysis.html#numeric-literals
if !exists("pyxlscript_no_number_highlight")
  " numbers (including longs and complex)
  syn match   pyxlscriptNumber	"\<0[oO]\=\o\+[Ll]\=\>"
  syn match   pyxlscriptNumber	"\<0[xX]\x\+[Ll]\=\>"
  syn match   pyxlscriptNumber	"\<0[bB][01]\+[Ll]\=\>"
  syn match   pyxlscriptNumber	"\<\%([1-9]\d*\|0\)[Ll]\=\>"
  syn match   pyxlscriptNumber	"\<\d\+[jJ]\>"
  syn match   pyxlscriptNumber	"\<\d\+[eE][+-]\=\d\+[jJ]\=\>"
  syn match   pyxlscriptNumber
	\ "\<\d\+\.\%([eE][+-]\=\d\+\)\=[jJ]\=\%(\W\|$\)\@="
  syn match   pyxlscriptNumber
	\ "\%(^\|\W\)\@<=\d*\.\d\+\%([eE][+-]\=\d\+\)\=[jJ]\=\>"
endif


if exists("pyxlscript_space_error_highlight")
  " trailing whitespace
  syn match   pyxlscriptSpaceError	display excludenl "\s\+$"
  " mixed tabs and spaces
  syn match   pyxlscriptSpaceError	display " \+\t"
  syn match   pyxlscriptSpaceError	display "\t\+ "
endif


" Sync at the beginning of class, function, or method definition.
syn sync match pyxlscriptSync grouphere NONE "^\s*\%(function\)\s\+\h\w*\s*("

if version >= 508 || !exists("did_pyxlscript_syn_inits")
  if version <= 508
    let did_pyxlscript_syn_inits = 1
    command -nargs=+ HiLink hi link <args>
  else
    command -nargs=+ HiLink hi def link <args>
  endif

  " The default highlight links.  Can be overridden later.
  HiLink pyxlscriptStatement	Statement
  HiLink pyxlscriptConditional	Conditional
  HiLink pyxlscriptRepeat		Repeat
  HiLink pyxlscriptOperator		Operator
  HiLink pyxlscriptFunction		Function
  HiLink pyxlscriptComment		Comment
  HiLink pyxlscriptTodo		    Todo
  HiLink pyxlscriptString		String
  HiLink pyxlscriptRawString	String
  HiLink pyxlscriptLiteral      Number
  HiLink pyxlscriptBoolean      Boolean
  HiLink pyxlscriptEscape		Special
  HiLink pyxlscriptModeLine		Special
  HiLink pyxlscriptBuiltIn	Function
  if !exists("pyxlscript_no_number_highlight")
    HiLink pyxlscriptNumber		Number
  endif
  if !exists("pyxlscript_no_builtin_highlight")
    HiLink pyxlscriptBuiltIn	Function
  endif
  if exists("pyxlscript_space_error_highlight")
    HiLink pyxlscriptSpaceError	Error
  endif

  delcommand HiLink
endif

let b:current_syntax = "pyxlscript"

" @TODO: turn this back on before being done
let &cpo = s:cpo_save
unlet s:cpo_save

" vim:set sw=2 sts=2 ts=8 noet:
