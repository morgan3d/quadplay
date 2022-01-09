define("ace/theme/quadplay",["require","exports","module","ace/lib/dom"], function(require, exports, module) {

exports.isDark = true;
exports.cssClass = "ace-quadplay";
exports.cssText = ".ace-quadplay .ace_gutter {\
background: #302b2b;\
color: #DEDEDE\
}\
.ace-quadplay .ace_print-margin {\
width: 1px;\
background: #302b2b\
}\
.ace-quadplay {\
background-color: #302b2b;\
color: #DEDEDE\
}\
.ace-quadplay .ace_cursor {\
color: #9F9F9F\
}\
.ace-quadplay .ace_marker-layer .ace_selection {\
background: #424242\
}\
.ace-quadplay.ace_multiselect .ace_selection.ace_start {\
box-shadow: 0 0 3px 0px #000000;\
}\
.ace-quadplay .ace_marker-layer .ace_step {\
background: rgb(102, 82, 0)\
}\
.ace-quadplay .ace_marker-layer .ace_bracket {\
margin: -1px 0 0 -1px;\
border: 1px solid #888888\
}\
.ace-quadplay .ace_marker-layer .ace_highlight {\
border: 1px solid rgb(110, 119, 0);\
border-bottom: 0;\
box-shadow: inset 0 -1px rgb(110, 119, 0);\
margin: -1px 0 0 -1px;\
background: rgba(255, 235, 0, 0.1)\
}\
.ace-quadplay .ace_gutter-active-line,\
.ace-quadplay .ace_marker-layer .ace_active-line {\
background: #363131\
}\
.ace-quadplay .ace_stack {\
background-color: rgb(66, 90, 44)\
}\
.ace-quadplay .ace_marker-layer .ace_selected-word {\
border: 1px solid #888888\
}\
.ace-quadplay .ace_invisible {\
color: #343434\
}\
.ace-quadplay .ace_keyword,\
.ace-quadplay .ace_meta,\
.ace-quadplay .ace_storage,\
.ace-quadplay .ace_storage.ace_type,\
.ace-quadplay .ace_support.ace_type {\
color: #a1aefe\
}\
.ace-quadplay .ace_keyword.ace_operator {\
color: #a1aefe\
}\
.ace-quadplay .ace_constant.ace_character,\
.ace-quadplay .ace_constant.ace_language,\
.ace-quadplay .ace_constant.ace_numeric,\
.ace-quadplay .ace_keyword.ace_other.ace_unit,\
.ace-quadplay .ace_support.ace_constant,\
.ace-quadplay .ace_variable.ace_parameter {\
color: #9df8fa\
}\
.ace-quadplay .ace_constant.ace_other {\
color: #9df8fa\
}\
.ace-quadplay .ace_invalid {\
color: #CED2CF;\
background-color: #DF5F5F\
}\
.ace-quadplay .ace_section, .ace-quadplay .ace_functiondecl {\
font-weight: 900;\
color:#fff\
}\
.ace-quadplay .ace_invalid.ace_deprecated {\
color: #CED2CF;\
background-color: #B798BF\
}\
.ace-quadplay .ace_fold {\
background-color: #7AA6DA;\
border-color: #DEDEDE\
}\
.ace-quadplay .ace_entity.ace_name.ace_function,\
.ace-quadplay .ace_support.ace_function\
{\
color: #f7a8fd\
}\
.ace-quadplay .ace_support.ace_class,\
.ace-quadplay .ace_support.ace_type {\
color: #E7C547\
}\
.ace-quadplay .ace_heading,\
.ace-quadplay .ace_markup.ace_heading,\
.ace-quadplay .ace_string {\
color: #FFB060\
}\
.ace-quadplay .ace_entity.ace_name.ace_tag,\
.ace-quadplay .ace_entity.ace_other.ace_attribute-name,\
.ace-quadplay .ace_meta.ace_tag,\
.ace-quadplay .ace_string.ace_regexp,\
.ace-quadplay .ace_variable {\
}\
.ace-quadplay .ace_comment {\
color: #93d884\
}\
.ace-quadplay .ace_c9searchresults.ace_keyword {\
color: #798aee\
}\
.ace-quadplay .ace_indent-guide {\
background: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZgbYnAAAAEklEQVQImWNgYGBgYFBXV/8PAAJoAXX4kT2EAAAAAElFTkSuQmCC) right repeat-y\
}";

var dom = require("../lib/dom");
dom.importCssString(exports.cssText, exports.cssClass);
});                (function() {
                    window.require(["ace/theme/quadplay"], function(m) {
                        if (typeof module == "object" && typeof exports == "object" && module) {
                            module.exports = m;
                        }
                    });
                })();
            
