define("ace/mode/pyxlscript_highlight_rules",["require","exports","module","ace/lib/oop","ace/mode/text_highlight_rules"], function(require, exports, module) {
    "use strict";

    var oop = require("../lib/oop");
    var TextHighlightRules = require("./text_highlight_rules").TextHighlightRules;

    var PyxlScriptHighlightRules = function() {

        // BEGIN KEYWORDS GENERATED CODE
        var keywords = "assert|todo|debug_pause|debug_print|debug_watch|with_camera|let|const|mod|local|preserving_transform|for|at|in|and|or|xor|not|with|while|until|if|then|else|push_mode|pop_mode|reset_game|set_mode|return|def|break|continue|default|bitand|bitnot|bitor|bitxor|bitshl|bitshr|because|quit_game|launch_game";
        // END KEYWORDS

        // BEGIN CONSTANTS GENERATED CODE
        var builtinConstants = "deg|true|false|nan|IDE_USER|VIEW_ARRAY|HOST_CODE|SCREEN_SIZE|pi|epsilon|infinity|nil|∞|½|⅓|⅔|¼|¾|⅕|⅖|⅗|⅘|⅙|⅐|⅛|⅑|⅒|°|ε|π|∅|∞|⁰|¹|²|³|⁴|⁵|⁶|⁷|⁸|⁹|CREDITS|CONSTANTS|ASSETS|SOURCE_LOCATION|gamepad_array|touch|joy";
        // END CONSTANTS

        // BEGIN FUNCTIONS GENERATED CODE
        var builtinFunctions = "set_screen_size|ray_intersect|ray_intersect_map|up_y|draw_bounds|draw_disk|reset_clip|reset_transform|set_clip|draw_line|draw_sprite_corner_rect|intersect_clip|draw_point|draw_corner_rect|reset_camera|set_camera|get_camera|draw_rect|get_background|set_background|text_width|get_sprite_pixel_color|draw_sprite|draw_text|draw_tri|draw_poly|get_transform|get_clip|rotation_sign|sign_nonzero|set_transform|xy|xz_to_xyz|xy_to_angle|angle_to_xy|xy_to_xyz|xz_to_xy|xy_to_xz|xz|xyz|any_button_press|any_button_release|draw_map|draw_map_span|map_resize|map_generate_maze|map_resize|get_mode|get_previous_mode|get_map_pixel_color|get_map_pixel_color_by_ws_coord|get_map_sprite|set_map_sprite|get_map_sprite_by_ws_coord|set_map_sprite_by_ws_coord|parse|unparse|format_number|uppercase|lowercase|resume_audio|get_audio_status|ray_value|play_sound|resume_sound|stop_audio|game_frames|mode_frames|delay|sequence|add_frame_hook|make_spline|remove_frame_hook|make_entity|entity_mass|entity_move|entity_inertia|entity_area|draw_entity|overlaps|entity_remove_all|entity_add_child|entity_remove_child|entity_update_children|entity_simulate|split|now|game_frames|mode_frames|replace|starts_with|ends_with|find_move|make_move_finder|map_find_path|find_path|make_array|join|entity_apply_force|entity_apply_impulse|perp|gray|rgb|rgba|hsv|hsva|last_value|last_key|insert|reverse|reversed|call|set_post_effects|get_post_effects|reset_post_effects|push_front|local_time|device_control|physics_add_contact_callback|physics_entity_contacts|physics_entity_has_contacts|physics_add_entity|physics_remove_entity|physics_remove_all|physics_attach|physics_detach|make_physics|make_contact_group|draw_physics|physics_simulate|min|max|mid|find_max_value|find_min_value|max_value|min_value|abs|acos|atan|asin|sign|sign_nonzero|cos|clamp|hash|smoothstep|lerp|lerp_angle|smootherstep|perceptual_lerp_color|log|log2|log10|noise|oscillate|pow|make_random|random_sign|random_integer|random_within_cube|random_within_region|random_within_sphere|random_on_sphere|random_within_circle|random_within_square|random_on_square|random_on_circle|random_direction2D|random_direction3D|random_value|random_gaussian3D|random_on_cube|random_gaussian|random_gaussian2D|random_truncated_gaussian|random_truncated_gaussian2D|random_truncated_gaussian3D|ξ|sqrt|cbrt|sin|set_random_seed|tan|conncatenate|extend|extended|deep_clone|clone|copy|draw_previous_mode|cross|direction|dot|equivalent|magnitude|magnitude_squared|max_component|min_component|xy|xyz|trim_spaces|slice|set_pause_menu|iterate|fast_remove_key|find|keys|remove_key|shuffle|shuffled|sort|sorted|resize|push|pop|pop_front|push_front|fast_remove_value|remove_values|remove_all|round|floor|ceil|todo|debug_pause|debug_print|resized|set_playback_rate|set_pitch|set_volume|set_pan|set_loop|remove_frame_hooks_by_mode|is_string|is_function|is_NaN|is_object|is_nil|is_boolean|is_number|is_array|rgb_to_xyz|axis_aligned_draw_box|load_local|save_local|transform_map_layer_to_ws_z|transform_ws_z_to_map_layer|transform_map_space_to_ws|transform_ws_to_map_space|transform_cs_to_ss|transform_cs_z_to_ws_z|transform_ws_z_to_cs_z|transform_ss_to_cs|transform_cs_to_ws|transform_ws_to_cs|transform_es_to_es|transform_es_to_sprite_space|transform_sprite_space_to_es|transform_to|transform_from|transform_es_to_ws|transform_ws_to_ws|transform_to_parent|transform_to_child|compose_transform|transform_ws_to_es|transform_cs_z_to_ss_z|transform_ss_z_to_cs_z|transform_ss_to_ws|transform_ws_to_ss|array_value|push_guest_menu_mode|stop_hosting|start_hosting|disconnect_guest|xyz_to_rgb|ABS|ADD|DIV|MAD|SUM|PROD|MUL|SUB|MAX|MIN|SIGN|CLAMP|LERP|RGB_ADD_RGB|RGB_SUB_RGB|RGB_MUL_RGB|RGB_DIV_RGB|RGB_MUL|RGB_DIV|RGB_DOT_RGB|RGB_LERP|RGBA_ADD_RGBA|RGBA_SUB_RGBA|RGBA_MUL_RGBA|RGBA_DIV_RGBA|RGBA_MUL|RGBA_DIV|RGBA_DOT_RGBA|RGBA_LERP|XY_MAD_S_XY|XY_MAD_XY_XY|XY_ADD_XY|XY_SUB_XY|XY_MUL_XY|XY_DIV_XY|XY_MUL|XY_DIV|XY_DOT_XY|XY_CRS_XY|XZ_ADD_XZ|XZ_SUB_XZ|XZ_MUL_XZ|XZ_DIV_XZ|XZ_MUL|XZ_DIV|XZ_DOT_XZ|XYZ_DIRECTION|XYZ_ADD_XYZ|XYZ_SUB_XYZ|XYZ_MUL_XYZ|XYZ_DIV_XYZ|XYZ_MUL|XYZ_DIV|XYZ_DOT_XYZ|XYZ_CRS_XYZ|XY_LERP|XYZ_LERP|XZ_LERP|XY_DIRECTION|XY_MAGNITUDE|XZ_MAGNITUDE|XYZ_MAGNITUDE|MAT2x2_MATMUL_XY|XZ_DIRECTION|MAT2x2_MATMUL_XZ|MAT3x3_MATMUL_XYZ|MAT3x4_MATMUL_XYZ|MAT3x4_MATMUL_XYZW";
        // END FUNCTIONS
        
        var keywordMapper = this.createKeywordMapper({
            "invalid.deprecated": "_^", // nothing
            "support.function": builtinFunctions,
            "constant.language": builtinConstants,
            "keyword": keywords,
            "variable.language": "_^" // nothing
        }, "identifier");

        var strPre = "[uU]?";
        var strRawPre = "[rR]";
        var strFormatPre = "[fF]";
        var strRawFormatPre = "(?:[rR][fF]|[fF][rR])";
        var decimalInteger = "(?:(?:[1-9]\\d*)|(?:0))";
        var octInteger = "(?:0[oO]?[0-7]+)";
        var hexInteger = "(?:0[xX][\\dA-Fa-f]+)";
        var binInteger = "(?:0[bB][01]+)";
        var integer = "(?:" + decimalInteger + "|" + octInteger + "|" + hexInteger + "|" + binInteger + ")";

        var exponent = "(?:[eE][+-]?\\d+)";
        var fraction = "(?:\\.\\d+)";
        var intPart = "(?:\\d+)";
        var pointFloat = "(?:(?:" + intPart + "?" + fraction + ")|(?:" + intPart + "\\.))";
        var exponentFloat = "(?:(?:" + pointFloat + "|" + intPart + ")" + exponent + ")";
        var floatNumber = "(?:" + exponentFloat + "|" + pointFloat + ")";

        var stringEscape = "\\\\(x[0-9A-Fa-f]{2}|[0-7]{3}|[\\\\abfnrtv'\"]|U[0-9A-Fa-f]{8}|u[0-9A-Fa-f]{4})";

        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent) || isUIWebView;

        this.$rules = {
            "start" : [
                {
                    token : "section",
                    regex : "^[A-Z_][A-Za-z_]+|^frame|^[-─—━⎯=═⚌]{5,}$"
                },
                {
                    token : "section",
                    regex : "^(enter|leave)(?=[^\\n]*$)"
                },
                (isSafari ? {} : // Safari doesn't support lookbehind
                 {
                     token : "functiondecl",
                     regex : "(?<=^[ ]*def[ ]+)([A-Za-z_]+)"
                 }),
                {
                    token : "comment",
                    regex : "//.*$"
                },
                {
                    token : "comment", // multi line comment
                    regex : "\\/\\*",
                    next : "multilinecomment"
                },
                {
                    token : "string",           // multi line """ string start
                    regex : strPre + '"{3}',
                    next : "qqstring3"
                }, {
                    token : "string",           // " string
                    regex : strPre + '"(?=.)',
                    next : "qqstring"
                }, {
                    token : "string",           // multi line ''' string start
                    regex : strPre + "'{3}",
                    next : "qstring3"
                }, {
                    token : "string",           // ' string
                    regex : strPre + "'(?=.)",
                    next : "qstring"
                }, {
                    token: "string",
                    regex: strRawPre + '"{3}',
                    next: "rawqqstring3"
                }, {
                    token: "string", 
                    regex: strRawPre + '"(?=.)',
                    next: "rawqqstring"
                }, {
                    token: "string",
                    regex: strRawPre + "'{3}",
                    next: "rawqstring3"
                }, {
                    token: "string",
                    regex: strRawPre + "'(?=.)",
                    next: "rawqstring"
                }, {
                    token: "string",
                    regex: strFormatPre + '"{3}',
                    next: "fqqstring3"
                }, {
                    token: "string",
                    regex: strFormatPre + '"(?=.)',
                    next: "fqqstring"
                }, {
                    token: "string",
                    regex: strFormatPre + "'{3}",
                    next: "fqstring3"
                }, {
                    token: "string",
                    regex: strFormatPre + "'(?=.)",
                    next: "fqstring"
                },{
                    token: "string",
                    regex: strRawFormatPre + '"{3}',
                    next: "rfqqstring3"
                }, {
                    token: "string",
                    regex: strRawFormatPre + '"(?=.)',
                    next: "rfqqstring"
                }, {
                    token: "string",
                    regex: strRawFormatPre + "'{3}",
                    next: "rfqstring3"
                }, {
                    token: "string",
                    regex: strRawFormatPre + "'(?=.)",
                    next: "rfqstring"
                }, {
                    token: "keyword.operator",
                    regex: "\\+|\\-|\\*|\\/|\\/\\/|<<|>>|\\||\\^|~|<|>|<=|=>|==|!=|=|¬|∩|∪|‖|⌊|⌋|⌈|⌉|…|∈|∊|≟|▶|◀|▶=|◀=|≠|≤|≥|\\.\\.\\."
                }, {
                    token: "punctuation",
                    regex: ",|:|;|\\->|\\+=|\\-=|\\*=|\\/=|\\/\\/=|>>=|<<="

                }, {
                    token: "paren.lparen",
                    regex: "[\\[\\(\\{]"
                }, {
                    token: "paren.rparen",
                    regex: "[\\]\\)\\}]"
                }, {
                    token: "text",
                    regex: "\\s+"
                }, {
                    include: "constants"
                }],
            "multilinecomment": [
                {
                    token: "comment",
                    regex: '\\*\\/',
                    next: "start"
                },
                {
                    defaultToken: "comment"
                }
            ],
            
            "qqstring3": [{
                token: "constant.language.escape",
                regex: stringEscape
            }, {
                token: "string", // multi line """ string end
                regex: '"{3}',
                next: "start"
            }, {
                defaultToken: "string"
            }],
            "qstring3": [{
                token: "constant.language.escape",
                regex: stringEscape
            }, {
                token: "string",  // multi line ''' string end
                regex: "'{3}",
                next: "start"
            }, {
                defaultToken: "string"
            }],
            "qqstring": [{
                token: "constant.language.escape",
                regex: stringEscape
            }, {
                token: "string",
                regex: "\\\\$",
                next: "qqstring"
            }, {
                token: "string",
                regex: '"|$',
                next: "start"
            }, {
                defaultToken: "string"
            }],
            "qstring": [{
                token: "constant.language.escape",
                regex: stringEscape
            }, {
                token: "string",
                regex: "\\\\$",
                next: "qstring"
            }, {
                token: "string",
                regex: "'|$",
                next: "start"
            }, {
                defaultToken: "string"
            }],
            "rawqqstring3": [{
                token: "string", // multi line """ string end
                regex: '"{3}',
                next: "start"
            }, {
                defaultToken: "string"
            }],
            "rawqstring3": [{
                token: "string",  // multi line ''' string end
                regex: "'{3}",
                next: "start"
            }, {
                defaultToken: "string"
            }],
            "rawqqstring": [{
                token: "string",
                regex: "\\\\$",
                next: "rawqqstring"
            }, {
                token: "string",
                regex: '"|$',
                next: "start"
            }, {
                defaultToken: "string"
            }],
            "rawqstring": [{
                token: "string",
                regex: "\\\\$",
                next: "rawqstring"
            }, {
                token: "string",
                regex: "'|$",
                next: "start"
            }, {
                defaultToken: "string"
            }],
            "fqqstring3": [{
                token: "constant.language.escape",
                regex: stringEscape
            }, {
                token: "string", // multi line """ string end
                regex: '"{3}',
                next: "start"
            }, {
                token: "paren.lparen",
                regex: "{",
                push: "fqstringParRules"
            }, {
                defaultToken: "string"
            }],
            "fqstring3": [{
                token: "constant.language.escape",
                regex: stringEscape
            }, {
                token: "string",  // multi line ''' string end
                regex: "'{3}",
                next: "start"
            }, {
                token: "paren.lparen",
                regex: "{",
                push: "fqstringParRules"
            }, {
                defaultToken: "string"
            }],
            "fqqstring": [{
                token: "constant.language.escape",
                regex: stringEscape
            }, {
                token: "string",
                regex: "\\\\$",
                next: "fqqstring"
            }, {
                token: "string",
                regex: '"|$',
                next: "start"
            }, {
                token: "paren.lparen",
                regex: "{",
                push: "fqstringParRules"
            }, {
                defaultToken: "string"
            }],
            "fqstring": [{
                token: "constant.language.escape",
                regex: stringEscape
            }, {
                token: "string",
                regex: "'|$",
                next: "start"
            }, {
                token: "paren.lparen",
                regex: "{",
                push: "fqstringParRules"
            }, {
                defaultToken: "string"
            }],
            "rfqqstring3": [{
                token: "string", // multi line """ string end
                regex: '"{3}',
                next: "start"
            }, {
                token: "paren.lparen",
                regex: "{",
                push: "fqstringParRules"
            }, {
                defaultToken: "string"
            }],
            "rfqstring3": [{
                token: "string",  // multi line ''' string end
                regex: "'{3}",
                next: "start"
            }, {
                token: "paren.lparen",
                regex: "{",
                push: "fqstringParRules"
            }, {
                defaultToken: "string"
            }],
            "rfqqstring": [{
                token: "string",
                regex: "\\\\$",
                next: "rfqqstring"
            }, {
                token: "string",
                regex: '"|$',
                next: "start"
            }, {
                token: "paren.lparen",
                regex: "{",
                push: "fqstringParRules"
            }, {
                defaultToken: "string"
            }],
            "rfqstring": [{
                token: "string",
                regex: "'|$",
                next: "start"
            }, {
                token: "paren.lparen",
                regex: "{",
                push: "fqstringParRules"
            }, {
                defaultToken: "string"
            }],
            "fqstringParRules": [{//TODO: nested {}
                token: "paren.lparen",
                regex: "[\\[\\(]"
            }, {
                token: "paren.rparen",
                regex: "[\\]\\)]"
            }, {
                token: "string",
                regex: "\\s+"
            }, {
                token: "string",
                regex: "'[^']*'"
            }, {
                token: "string",
                regex: '"[^"]*"'
            }, {
                token: "function.support",
                regex: "(!s|!r|!a)"
            }, {
                include: "constants"
            },{
                token: 'paren.rparen',
                regex: "}",
                next: 'pop'
            },{
                token: 'paren.lparen',
                regex: "{",
                push: "fqstringParRules"
            }],

            "constants": [
                {
                    token: "constant.numeric",
                    regex: "[%°∞½⅓⅔¼¾⅕⅖⅗⅘⅙⅐⅛⅑⅒°επ∅∞⁰¹²³⁴⁵⁶⁷⁸⁹]"},
                {
                    token: "constant.numeric", // imaginary
                    regex: "(?:" + floatNumber + "|\\d+)[jJ]\\b"
                }, {
                    token: "constant.numeric", // float
                    regex: floatNumber
                }, {
                    token: "constant.numeric", // long integer
                    regex: integer + "[lL]\\b"
                }, {
                    token: "constant.numeric", // integer
                    regex: integer + "\\b"
                }, {
                    token: ["punctuation", "variable"],// method
                    regex: "(\\.)([a-zA-Z_]+)\\b"
                }, {
                    token: "support.function",
                    regex: "\\b(?:random|size|loop)(?=\\()"
                }, {
                    token: keywordMapper,
                    regex: "[a-zA-Z_$][a-zA-Z0-9_$]*\\b"
                }]
        };
        this.normalizeRules();
    };

    oop.inherits(PyxlScriptHighlightRules, TextHighlightRules);

    exports.PyxlScriptHighlightRules = PyxlScriptHighlightRules;
});

define("ace/mode/folding/pyxlscriptic",["require","exports","module","ace/lib/oop","ace/mode/folding/fold_mode"], function(require, exports, module) {
    "use strict";

    var oop = require("../../lib/oop");
    var BaseFoldMode = require("./fold_mode").FoldMode;

    var FoldMode = exports.FoldMode = function(markers) {
        this.foldingStartMarker = new RegExp("([\\[{])(?:\\s*)$|(" + markers + ")(?:\\s*)(?:#.*)?$");
    };
    oop.inherits(FoldMode, BaseFoldMode);

    (function() {

        this.getFoldWidgetRange = function(session, foldStyle, row) {
            var line = session.getLine(row);
            var match = line.match(this.foldingStartMarker);
            if (match) {
                if (match[1])
                    return this.openingBracketBlock(session, match[1], row, match.index);
                if (match[2])
                    return this.indentationBlock(session, row, match.index + match[2].length);
                return this.indentationBlock(session, row);
            }
        };

    }).call(FoldMode.prototype);

});

define("ace/mode/pyxlscript",["require","exports","module","ace/lib/oop","ace/mode/text","ace/mode/pyxlscript_highlight_rules","ace/mode/folding/pyxlscriptic","ace/range"], function(require, exports, module) {
    "use strict";

    var oop = require("../lib/oop");
    var TextMode = require("./text").Mode;
    var PyxlScriptHighlightRules = require("./pyxlscript_highlight_rules").PyxlScriptHighlightRules;
    var PyxlScriptFoldMode = require("./folding/pyxlscriptic").FoldMode;
    var Range = require("../range").Range;

    var Mode = function() {
        this.HighlightRules = PyxlScriptHighlightRules;
        this.foldingRules = new PyxlScriptFoldMode("\\:");
        this.$behaviour = this.$defaultBehaviour;
    };
    oop.inherits(Mode, TextMode);

    (function() {

        this.lineCommentStart = "//";

        this.getNextLineIndent = function(state, line, tab) {
            var indent = this.$getIndent(line);

            var tokenizedLine = this.getTokenizer().getLineTokens(line, state);
            var tokens = tokenizedLine.tokens;

            if (tokens.length && tokens[tokens.length-1].type == "comment") {
                return indent;
            }

            if (state == "start") {
                var match = line.match(/^.*[\{\(\[:]\s*$/);
                if (match) {
                    indent += tab;
                }
            }

            return indent;
        };

        var outdents = {
            "return": 1,
            "break": 1,
            "continue": 1
        };
        
        this.checkOutdent = function(state, line, input) {
            if (input !== "\r\n" && input !== "\r" && input !== "\n")
                return false;

            var tokens = this.getTokenizer().getLineTokens(line.trim(), state).tokens;
            
            if (!tokens)
                return false;
            do {
                var last = tokens.pop();
            } while (last && (last.type == "comment" || (last.type == "text" && last.value.match(/^\s+$/))));
            
            if (!last)
                return false;
            
            return (last.type == "keyword" && outdents[last.value]);
        };

        this.autoOutdent = function(state, doc, row) {
            
            row += 1;
            var indent = this.$getIndent(doc.getLine(row));
            var tab = doc.getTabString();
            if (indent.slice(-tab.length) === tab)
                doc.remove(new Range(row, indent.length-tab.length, row, indent.length));
        };

        this.$id = "ace/mode/pyxlscript";
    }).call(Mode.prototype);

    exports.Mode = Mode;
});

(function() {
    window.require(["ace/mode/pyxlscript"], function(m) {
        if (typeof module == "object" && typeof exports == "object" && module) {
            module.exports = m;
        }
    });
})();

