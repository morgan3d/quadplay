/*
Language: PyxlScript
Category: other
Author: Morgan McGuire <morgan@casual-effects.com>
Description: Python-like language for the quadplay+ fantasy console
*/

export default function(hljs) {
    var KEYWORDS = {
        keyword: 
        // BEGIN KEYWORDS GENERATED CODE
        "assert todo debug_pause debug_print|4 debug_watch with_camera let|2 const mod local preserving_transform|10 for at in and or xor not with while until if then else push_mode pop_mode reset_game set_mode return def break continue default bitand bitnot bitor bitxor bitshl bitshr because quit_game launch_game deg true false nan IDE_USER VIEW_ARRAY HOST_CODE SCREEN_SIZE pi epsilon infinity nil|2 ∞ ½ ⅓ ⅔ ¼ ¾ ⅕ ⅖ ⅗ ⅘ ⅙ ⅐ ⅛ ⅑ ⅒ ° ε π ∅ ∞ ⁰ ¹ ² ³ ⁴ ⁵ ⁶ ⁷ ⁸ ⁹ CREDITS CONSTANTS ASSETS SOURCE_LOCATION gamepad_array touch joy"
        // END KEYWORDS
        ,
        built_in: 
        // BEGIN FUNCTIONS GENERATED CODE
        "set_screen_size ray_intersect ray_intersect_map up_y draw_bounds draw_disk reset_clip reset_transform set_clip draw_line draw_sprite_corner_rect intersect_clip draw_point draw_corner_rect reset_camera set_camera get_camera draw_rect get_background set_background text_width sprite_transfer_orientation get_sprite_pixel_color draw_sprite draw_text draw_tri draw_poly get_transform get_clip rotation_sign sign_nonzero set_transform xy xz_to_xyz xy_to_angle angle_to_xy xy_to_xyz xz_to_xy xy_to_xz xz xyz any_button_press any_button_release draw_map draw_map_span map_resize map_generate_maze map_resize get_mode get_previous_mode get_map_pixel_color get_map_pixel_color_by_ws_coord get_map_sprite set_map_sprite get_map_sprite_by_ws_coord set_map_sprite_by_ws_coord parse unparse format_number uppercase lowercase resume_audio get_audio_status ray_value play_sound stop_audio game_frames mode_frames delay sequence add_frame_hook make_spline remove_frame_hook make_entity entity_mass entity_move entity_inertia entity_area draw_entity overlaps entity_remove_all entity_add_child entity_remove_child entity_update_children entity_simulate split now game_frames mode_frames replace starts_with ends_with find_move make_move_finder map_find_path find_path make_array join entity_apply_force entity_apply_impulse perp gray rgb rgba hsv hsva last_value last_key insert reverse reversed call set_post_effects get_post_effects reset_post_effects push_front local_time device_control physics_add_contact_callback physics_entity_contacts physics_entity_has_contacts physics_add_entity physics_remove_entity physics_remove_all physics_attach physics_detach make_physics make_contact_group draw_physics physics_simulate min max mid find_max_value find_min_value max_value min_value abs acos atan asin sign sign_nonzero cos clamp hash smoothstep lerp lerp_angle smootherstep perceptual_lerp_color log log2 log10 noise oscillate pow make_random random_sign random_integer random_within_cube random_within_region random_within_sphere random_on_sphere random_within_circle random_within_region random_within_square random_on_square random_on_circle random_direction2D random_direction3D random_value random_gaussian3D random_on_cube random_gaussian random_gaussian2D random_truncated_gaussian random_truncated_gaussian2D random_truncated_gaussian3D ξ sqrt cbrt sin set_random_seed tan conncatenate extend extended make_bot_gamepad update_bot_gamepad deep_immutable_clone deep_clone clone copy draw_previous_mode cross direction dot equivalent magnitude magnitude_squared max_component min_component xy xyz trim_spaces slice set_pause_menu iterate iterate_pairs fast_remove_key find keys remove_key shuffle shuffled sort sorted resize push pop pop_front push_front fast_remove_value remove_values remove_all round floor ceil todo debug_pause debug_print resized set_playback_rate set_pitch set_volume set_pan set_loop remove_frame_hooks_by_mode is_string is_function is_NaN is_object is_nil is_boolean is_number is_array rgb_to_xyz axis_aligned_draw_box load_local save_local transform_map_layer_to_ws_z transform_ws_z_to_map_layer transform_map_space_to_ws transform_ws_to_map_space transform_cs_to_ss transform_cs_z_to_ws_z transform_ws_z_to_cs_z transform_ss_to_cs transform_cs_to_ws transform_ws_to_cs transform_es_to_es transform_es_to_sprite_space transform_sprite_space_to_es transform_to transform_from transform_es_to_ws transform_ws_to_ws transform_to_parent transform_to_child compose_transform transform_ws_to_es transform_cs_z_to_ss_z transform_ss_z_to_cs_z transform_ss_to_ws transform_ws_to_ss array_value push_guest_menu_mode stop_hosting start_hosting disconnect_guest unparse_hex_color xyz_to_rgb ABS ADD DIV MAD SUM PROD MUL SUB MAX MIN MEAN MEAN3 MEAN4 SIGN CLAMP LERP RGB_ADD_RGB RGB_SUB_RGB RGB_MUL_RGB RGB_DIV_RGB RGB_MUL RGB_DIV RGB_DOT_RGB RGB_LERP RGBA_ADD_RGBA RGBA_SUB_RGBA RGBA_MUL_RGBA RGBA_DIV_RGBA RGBA_MUL RGBA_DIV RGBA_DOT_RGBA RGBA_LERP XY_DISTANCE XZ_DISTANCE XYZ_DISTANCE XY_MAD_S_XY XY_MAD_XY_XY XY_ADD_XY XY_SUB_XY XY_MUL_XY XY_DIV_XY XY_MUL XY_DIV XY_DOT_XY XY_CRS_XY XZ_ADD_XZ XZ_SUB_XZ XZ_MUL_XZ XZ_DIV_XZ XZ_MUL XZ_DIV XZ_DOT_XZ XYZ_DIRECTION XYZ_ADD_XYZ XYZ_SUB_XYZ XYZ_MAD_S_XYZ XYZ_MUL_XYZ XYZ_DIV_XYZ XYZ_MUL XYZ_DIV XYZ_DOT_XYZ XYZ_CRS_XYZ XY_LERP XYZ_LERP XZ_LERP XY_DIRECTION XY_MAGNITUDE XZ_MAGNITUDE XYZ_MAGNITUDE MAT2x2_MATMUL_XY XZ_DIRECTION MAT2x2_MATMUL_XZ MAT3x3_MATMUL_XYZ MAT3x4_MATMUL_XYZ MAT3x4_MATMUL_XYZW"
        // END FUNCTIONS
    };
    var SUBST = {
        className: 'subst',
        begin: /\{/, end: /\}/,
        keywords: KEYWORDS//,
        // illegal: /#/
    };
    var STRING = {
        className: 'string',
        contains: [hljs.BACKSLASH_ESCAPE],
        variants: [
            {
                begin: /(u|r|ur)"/, end: /"/,
                relevance: 10
            },
            {
                begin: /(b|br)"/, end: /"/
            },
            {
                begin: /(fr|rf|f)"/, end: /"/,
                contains: [hljs.BACKSLASH_ESCAPE, SUBST]
            },
            hljs.QUOTE_STRING_MODE
        ]
    };
    var LINE = {
        className: 'section',
        relevance: 10,
        variants: [
            {begin: /^[^\n]+?\\n(-|─|—|━|⎯|=|═|⚌){5,}/}
        ]
    };
    var NUMBER = {
        className: 'number', relevance: 0,
        variants: [
            {begin: /∅|[+-]?[∞επ½⅓⅔¼¾⅕⅖⅗⅘⅙⅐⅛⅑⅒`]/},
            {begin: /#[0-7a-fA-F]+/},
            {begin: /\b[+-]?(\d*\.)?\d+(%|deg|°)?/},
            {begin: /[₀₁₂₃₄₅₆₇₈₉⁰¹²³⁴⁵⁶⁷⁸⁹]/}
        ]
    };
    var PARAMS = {
        className: 'params',
        begin: /\(/, end: /\)/,
        contains: [NUMBER, STRING]
    };
    SUBST.contains = [STRING, NUMBER];
    return {
        aliases: ['pyxlscript'],
        keywords: KEYWORDS,
        illegal: /(<\/|->|\?)|=>|@|\$/,
        contains: [
            LINE,
            NUMBER,
            STRING,
            {
                className: 'built_in',
                variants:
                [{begin:
                  /\b(loop|size|random)(?=\()/
                 }]
            },
            hljs.C_LINE_COMMENT_MODE,
            hljs.C_BLOCK_COMMENT_MODE,
            {
                variants: [
                    {className: 'function', beginKeywords: 'def'}
                ],
                end: /:/,
                illegal: /[${=;\n,]/,
                contains: [
                    hljs.UNDERSCORE_TITLE_MODE,
                    PARAMS,
                    {
                        begin: /->/, endsWithParent: true,
                        keywords: 'None'
                    }
                ]
            }
        ]
    };
}
