" Vim syntax file
" Language:	Quadplay (pyxlscript)
" Maintainer:	Stephan Steinbach 
" Last Change:	2019 Jul 04
" Credits:	Based on python.vim by Neil Schemenauer <nas@python.ca> + the
"           emacs file by Morgan McGuire.
"
" For version 5.x: Clear all syntax items.
" For version 6.x: Quit when a syntax file was already loaded.
echom "foo"
if version < 600
  syntax clear
elseif exists("b:current_syntax")
  finish
endif
"
" We need nocompatible mode in order to continue lines with backslashes.
" Original setting will be restored.
let s:cpo_save = &cpo
set cpo&vim

" Capture the modes and separators
syn match pyxlscriptModeLine '^init$\n^─\+$\|^enter$\n^─\+$\|^frame$\n^─\+$\|^leave$\n^─\+$' 

syn keyword pyxlscriptStatement let const in return break continue ∊ ∈
syn keyword pyxlscriptLiteral ½ ⅓ ⅔ ¼ ¾ ⅕ ⅖ ⅗ ⅘ ⅙ ⅐ ⅛ ⅑ ⅒ ° deg ε π nan ∅ screenSize pi epsilon infinity nil
syn keyword pyxlscriptBoolean true false
syn keyword pyxlscriptBuiltIn addFrameHook removeFrameHook drawSprite drawText drawTri textWidth getTransform getClip getRotationSign setTransform unparse formatNumber lowerCase upperCase xy xyz drawMap stopSound playAudioClip gameFrames modeFrames now gameFrames modeFrames gray rgb rgba hsv hsva call abs acos atan getPreviousMode getMode sign getMapSprite getMapPixelColor getMapSpriteByDrawCoord getMapPixelColorByDrawCoord getSpritePixelColor signNonZero asin cos clamp hash lerp loop min max mid noise oscillate overlap pow rndValue rndInt rnd ξ sgn sqrt sin srand tan clone copy cross direction dot equivalent magnitude maxComponent minComponent xy xyz fastRemoveKey find keys removeKey size substring sort resize push pop removeValues pad joy debugPrint drawDisk physicsStepEntity setTransform resetTransform resetClip setClip drawLine drawPreviousMode drawPoint makeEntity overlaps updateEntityChildren drawEntity intersectClip drawSpriteRect drawRect setBackground assert debugWatch rayIntersect drawBounds anyButtonPress 

syn match pyxlscriptColor "#[0-9A-Fa-f]+"

" syn keyword pythonStatement	False, None, True
" syn keyword pythonStatement	as assert break continue del exec global
" syn keyword pythonStatement	lambda nonlocal pass print return with yield
syn keyword pyxlscriptStatement	function nextgroup=pyxlscriptFunction skipwhite
syn keyword pyxlscriptStatement	def nextgroup=pyxlscriptDef skipwhite
syn keyword pyxlscriptStatement return local preservingTransform with setMode resetGame
syn keyword pyxlscriptConditional if else
syn keyword pyxlscriptRepeat	for while until
syn keyword pyxlscriptOperator	and in is not or
" syn keyword pythonException	except finally raise try
" syn keyword pythonInclude	from import

" Decorators (new in Python 2.4)
" syn match   pythonDecorator	"@" display nextgroup=pythonFunction skipwhite
" The zero-length non-grouping match before the function name is
" extremely important in pythonFunction.  Without it, everything is
" interpreted as a function inside the contained environment of
" doctests.
" A dot must be allowed because of @MyClass.myfunc decorators.
syn match   pyxlscriptFunction
      \ "\%(\%(function\s\)\s*\)\@<=\h\%(\w\|\.\)*" contained
syn match   pyxlscriptDef
      \ "\%(\%(def\s\)\s*\)\@<=\h\%(\w\|\.\)*" contained

syn match   pyxlscriptComment	"//.*$" contains=pyxlscriptTodo,@Spell
syn keyword pyxlscriptTodo		FIXME NOTE NOTES TODO XXX contained

" Triple-quoted strings can contain doctests.
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
" Python allows case-insensitive Unicode IDs: http://www.unicode.org/charts/
syn match   pyxlscriptEscape	"\\N{.\{-}}" contained
syn match   pyxlscriptEscape	"\\$"

if exists("pyxlscript_highlight_all")
  if exists("pyxlscript_no_builtin_highlight")
    unlet pyxlscript_no_builtin_highlight
  endif
  if exists("pyxlscript_no_doctest_code_highlight")
    unlet pyxlscript_no_doctest_code_highlight
  endif
  if exists("pyxlscript_no_doctest_highlight")
    unlet pyxlscript_no_doctest_highlight
  endif
  if exists("pyxlscript_no_exception_highlight")
    unlet pyxlscript_no_exception_highlight
  endif
  if exists("pyxlscript_no_number_highlight")
    unlet pyxlscript_no_number_highlight
  endif
  let pyxlscript_space_error_highlight = 1
endif

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
" and so on, as specified in the 'Python Language Reference'.
" http://docs.python.org/reference/lexical_analysis.html#numeric-literals
if !exists("python_no_number_highlight")
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


if exists("python_space_error_highlight")
  " trailing whitespace
  syn match   pyxlscriptSpaceError	display excludenl "\s\+$"
  " mixed tabs and spaces
  syn match   pyxlscriptSpaceError	display " \+\t"
  syn match   pyxlscriptSpaceError	display "\t\+ "
endif


" Sync at the beginning of class, function, or method definition.
syn sync match pythonSync grouphere NONE "^\s*\%(function\)\s\+\h\w*\s*("

if version >= 508 || !exists("did_python_syn_inits")
  if version <= 508
    let did_python_syn_inits = 1
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
  if !exists("python_no_number_highlight")
    HiLink pyxlscriptNumber		Number
  endif
  if !exists("python_no_builtin_highlight")
    HiLink pyxlscriptBuiltIn	Function
  endif
  if exists("python_space_error_highlight")
    HiLink pyxlscriptSpaceError	Error
  endif

  delcommand HiLink
endif

let b:current_syntax = "pyxlscript"

" @TODO: turn this back on before being done
let &cpo = s:cpo_save
unlet s:cpo_save

" vim:set sw=2 sts=2 ts=8 noet:
