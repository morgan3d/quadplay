;; pyxlscript-mode.el --- Major mode for editing Quadplay PyxLScript. -*- coding: utf-8 -*-

;; Copyright © 2019, by Morgan McGuire

;; Author: Morgan McGuire, https://casual-effects.com
;; URL: TBD
;; Version: 0.0.1
;; Keywords: languages, pyxlscript

;; To use this mode, put the file in your elisp directory. Mine is "~/.emacs.d/lisp"
;; and then add to your .emacs:
;;
;;   (autoload 'pyxlscript-mode "pyxlscript-mode")
;;   (add-to-list 'auto-mode-alist '("\\.pyx\\'" . pyxlscript-mode))


;; See http://ergoemacs.org/emacs/elisp_write_major_mode_index.html
(defvar pyxlscript-mode-syntax-table nil "Syntax table for `pyxlscript-mode'.")

(setq pyxlscript-mode-syntax-table
      (let ( (synTable (make-syntax-table)))
        ;; C and C++ style comments "// …", "/* … */" (based on https://github.com/emacs-mirror/emacs/blob/master/lisp/progmodes/cc-langs.el)
        (modify-syntax-entry ?/  ". 124b" synTable)
        (modify-syntax-entry ?*  ". 23"   synTable)
        (modify-syntax-entry ?\n "> b"  synTable)
        synTable))

(define-derived-mode pyxlscript-mode python-mode "pyxlscript"
  "Major mode to edit Pyxlscript files." :syntax-table pyxlscript-mode-syntax-table

  ;; 3-space indenting
  (setq-local tab-width 3)
  (setq python-indent 3)
  (setq python-guess-indent nil)
  
  (setq-local comment-start "/*")
  (setq-local comment-start-skip "/\\*+[ \t]*")
  (setq-local comment-end "*/")
  (setq-local comment-end-skip "[ \t]*\\*+/")

  (let ((keyword-exp (regexp-opt '("assert" "debugPrint" "debugWatch" "let" "const" "mod" "local" "preservingTransform" "for" "in" "while" "until" "if" "then" "else" "pushMode" "popMode" "resetGame" "setMode" "return" "def" "break" "continue" "bitand" "bitor" "bitxor" "because" "quitGame" "launchGame") 'words))
        (literal-exp (regexp-opt '("deg" "true" "false" "nan" "screenSize" "pi" "epsilon" "infinity" "nil") 'words))
        (builtin-exp (regexp-opt '("rayIntersect" "drawBounds" "drawDisk" "resetClip" "resetTransform" "setClip" "drawLine" "drawSpriteRect" "intersectClip" "drawPoint" "drawRect" "setBackground" "textWidth" "getSpritePixelColor" "drawSprite" "drawText" "drawTri" "getTransform" "getClip" "getRotationSign" "setTransform" "xy" "xyz"
                                   "anyButtonPress" "drawMap" "getMode" "getPreviousMode" "getMapPixelColor" "getMapPixelColorByDrawCoord" "getMapSprite" "setMapSprite" "getMapSpriteByDrawCoord" "setMapSpriteByDrawCoord" "unparse" "formatNumber" "upperCase" "lowerCase"
                                   "playAudioClip" "resumeSound" "stopSound" "gameFrames" "modeFrames" "setMode" "addFrameHook" "removeFrameHook"
                                   "makeEntity" "drawEntity" "overlaps" "updateEntityChildren" "physicsStepEntity"
                                   "now" "gameFrames" "modeFrames" "findMapPath" "findPath"
                                   "gray" "rgb" "rgba" "hsv" "hsva"
                                   "call" "setPostEffects" "resetPostEffects"
                                   "abs" "acos" "atan" "asin" "sign" "signNonZero" "cos" "clamp" "hash" "lerp" "log" "log2" "log10" "loop" "min" "max" "mid" "noise" "oscillate" "overlap" "pow" "rndInt" "rndDisk" "rndSquare" "rndValue" "rnd" "ξ" "sgn" "sqrt" "sin" "srand" "tan"
                                   "clone" "copy" "drawPreviousMode" "cross" "direction" "dot" "equivalent" "magnitude" "maxComponent" "minComponent" "xy" "xyz"
                                   "fastRemoveKey" "find" "keys" "removeKey" "size" "substring" "sort" "resize" "push" "pop" "removeValues" "pad" "joy" "round" "floor" "ceil"
                                   "debugPrint") 'words))
        (color-exp   "#[0-9A-Fa-f]+"))

    ; Regexps don't understand unicode
    (font-lock-add-keywords
     'pyxlscript-mode
     `((,keyword-exp (0 font-lock-keyword-face))
       (,builtin-exp (0 font-lock-type-face))
       (,color-exp (0 font-lock-constant-face))
       (,literal-exp (0 font-lock-constant-face))
       ("‖" . font-lock-type-face)
       ("⌊" . font-lock-type-face)
       ("⌋" . font-lock-type-face)
       ("⌈" . font-lock-type-face)
       ("⌉" . font-lock-type-face)        
       ("∊" . font-lock-keyword-face)
       ("∈" . font-lock-keyword-face)
       ("∞" . font-lock-constant-face)
       ("½" . font-lock-constant-face)
       ("⅓" . font-lock-constant-face)
       ("⅔" . font-lock-constant-face)
       ("¼" . font-lock-constant-face)
       ("¾" . font-lock-constant-face)
       ("⅕" . font-lock-constant-face)
       ("⅖" . font-lock-constant-face)
       ("⅗" . font-lock-constant-face)
       ("⅘" . font-lock-constant-face)
       ("⅙" . font-lock-constant-face)
       ("⅐" . font-lock-constant-face)
       ("⅛" . font-lock-constant-face)
       ("⅑" . font-lock-constant-face)
       ("⅒" . font-lock-constant-face)
       ("°" . font-lock-constant-face)
       ("ε" . font-lock-constant-face)
       ("π" . font-lock-constant-face)
       ("∅" . font-lock-constant-face)
       ("∞" . font-lock-constant-face)
       ("⁰" . font-lock-constant-face)
       ("¹" . font-lock-constant-face)
       ("²" . font-lock-constant-face)
       ("³" . font-lock-constant-face)
       ("⁴" . font-lock-constant-face)
       ("⁵" . font-lock-constant-face)
       ("⁶" . font-lock-constant-face)
       ("⁷" . font-lock-constant-face)
       ("⁸" . font-lock-constant-face)
       ("⁹" . font-lock-constant-face)          
       )))
  
  (set-syntax-table pyxlscript-mode-syntax-table)
  )

(provide 'pyxlscript-mode)
