" Vim syntax file
" Language:	Quadplay (pyxlscript)
" Maintainer:	Stephan Steinbach 
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

" BEGIN CONSTANTS GENERATED CODE
syn keyword pyxlscriptLiteral deg nan IDE_USER VIEW_ARRAY HOST_CODE SCREEN_SIZE pi epsilon infinity nil ∞ ½ ⅓ ⅔ ¼ ¾ ⅕ ⅖ ⅗ ⅘ ⅙ ⅐ ⅛ ⅑ ⅒ ° ε π ∅ ∞ ⁰ ¹ ² ³ ⁴ ⁵ ⁶ ⁷ ⁸ ⁹ CREDITS CONSTANTS ASSETS SOURCE_LOCATION gamepad_array touch joy
" END CONSTANTS

syn keyword pyxlscriptBoolean true false

" BEGIN FUNCTIONS GENERATED CODE
syn keyword pyxlscriptBuiltIn set_screen_size ray_intersect ray_intersect_map up_y draw_bounds draw_disk reset_clip reset_transform set_clip draw_line draw_sprite_corner_rect intersect_clip draw_point draw_corner_rect reset_camera set_camera get_camera draw_rect get_background set_background text_width sprite_transfer_orientation get_sprite_pixel_color draw_sprite draw_text draw_tri draw_poly get_transform get_clip rotation_sign sign_nonzero set_transform xy xz_to_xyz xy_to_angle angle_to_xy xy_to_xyz xz_to_xy xy_to_xz xz xyz any_button_press any_button_release draw_map draw_map_span map_resize map_generate_maze map_resize get_mode get_previous_mode get_map_pixel_color get_map_pixel_color_by_ws_coord get_map_sprite set_map_sprite get_map_sprite_by_ws_coord set_map_sprite_by_ws_coord parse unparse format_number uppercase lowercase resume_audio get_audio_status ray_value play_sound stop_audio game_frames mode_frames delay sequence add_frame_hook make_spline remove_frame_hook make_entity entity_mass entity_move entity_inertia entity_area draw_entity overlaps entity_remove_all entity_add_child entity_remove_child entity_update_children entity_simulate split now game_frames mode_frames replace starts_with ends_with find_move make_move_finder map_find_path find_path make_array join entity_apply_force entity_apply_impulse perp gray rgb rgba hsv hsva last_value last_key insert reverse reversed call set_post_effects get_post_effects reset_post_effects push_front local_time device_control physics_add_contact_callback physics_entity_contacts physics_entity_has_contacts physics_add_entity physics_remove_entity physics_remove_all physics_attach physics_detach make_physics make_contact_group draw_physics physics_simulate min max mid find_max_value find_min_value max_value min_value abs acos atan asin sign sign_nonzero cos clamp hash smoothstep lerp lerp_angle smootherstep perceptual_lerp_color log log2 log10 noise oscillate pow make_random random_sign random_integer random_within_cube random_within_region random_within_sphere random_on_sphere random_within_circle random_within_region random_within_square random_on_square random_on_circle random_direction2D random_direction3D random_value random_gaussian3D random_on_cube random_gaussian random_gaussian2D random_truncated_gaussian random_truncated_gaussian2D random_truncated_gaussian3D ξ sqrt cbrt sin set_random_seed tan conncatenate extend extended make_bot_gamepad update_bot_gamepad deep_immutable_clone deep_clone clone copy draw_previous_mode cross direction dot equivalent magnitude magnitude_squared max_component min_component xy xyz trim_spaces slice set_pause_menu iterate iterate_pairs fast_remove_key find keys remove_key shuffle shuffled sort sorted resize push pop pop_front push_front fast_remove_value remove_values remove_all round floor ceil todo debug_pause debug_print resized set_playback_rate set_pitch set_volume set_pan set_loop remove_frame_hooks_by_mode is_string is_function is_NaN is_object is_nil is_boolean is_number is_array rgb_to_xyz axis_aligned_draw_box load_local save_local transform_map_layer_to_ws_z transform_ws_z_to_map_layer transform_map_space_to_ws transform_ws_to_map_space transform_cs_to_ss transform_cs_z_to_ws_z transform_ws_z_to_cs_z transform_ss_to_cs transform_cs_to_ws transform_ws_to_cs transform_es_to_es transform_es_to_sprite_space transform_sprite_space_to_es transform_to transform_from transform_es_to_ws transform_ws_to_ws transform_to_parent transform_to_child compose_transform transform_ws_to_es transform_cs_z_to_ss_z transform_ss_z_to_cs_z transform_ss_to_ws transform_ws_to_ss array_value push_guest_menu_mode stop_hosting start_hosting disconnect_guest unparse_hex_color xyz_to_rgb ABS ADD DIV MAD SUM PROD MUL SUB MAX MIN MEAN MEAN3 MEAN4 SIGN CLAMP LERP RGB_ADD_RGB RGB_SUB_RGB RGB_MUL_RGB RGB_DIV_RGB RGB_MUL RGB_DIV RGB_DOT_RGB RGB_LERP RGBA_ADD_RGBA RGBA_SUB_RGBA RGBA_MUL_RGBA RGBA_DIV_RGBA RGBA_MUL RGBA_DIV RGBA_DOT_RGBA RGBA_LERP XY_DISTANCE XZ_DISTANCE XYZ_DISTANCE XY_MAD_S_XY XY_MAD_XY_XY XY_ADD_XY XY_SUB_XY XY_MUL_XY XY_DIV_XY XY_MUL XY_DIV XY_DOT_XY XY_CRS_XY XZ_ADD_XZ XZ_SUB_XZ XZ_MUL_XZ XZ_DIV_XZ XZ_MUL XZ_DIV XZ_DOT_XZ XYZ_DIRECTION XYZ_ADD_XYZ XYZ_SUB_XYZ XYZ_MAD_S_XYZ XYZ_MUL_XYZ XYZ_DIV_XYZ XYZ_MUL XYZ_DIV XYZ_DOT_XYZ XYZ_CRS_XYZ XY_LERP XYZ_LERP XZ_LERP XY_DIRECTION XY_MAGNITUDE XZ_MAGNITUDE XYZ_MAGNITUDE MAT2x2_MATMUL_XY XZ_DIRECTION MAT2x2_MATMUL_XZ MAT3x3_MATMUL_XYZ MAT3x4_MATMUL_XYZ MAT3x4_MATMUL_XYZW
" END FUNCTIONS

syn match pyxlscriptColor "#[0-9A-Fa-f]+"

" BEGIN KEYWORDS GENERATED CODE
syn keyword pyxlscriptStatement assert todo debug_pause debug_print debug_watch with_camera let const mod local preserving_transform with push_mode pop_mode reset_game set_mode return break continue default bitand bitnot bitor bitxor bitshl bitshr because quit_game launch_game
" END KEYWORDS


syn keyword pyxlscriptStatement	def nextgroup=pyxlscriptDef skipwhite
syn keyword pyxlscriptConditional if else then
syn keyword pyxlscriptRepeat	for while until
syn keyword pyxlscriptOperator	and in is not or ∊ ∈ at xor

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
