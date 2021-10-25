# Updates quadplay fonts from the original format
# to the 2021-10-14 format

import png, math, operator, workjson, sys

    
class Image:
    width = 0
    height = 0

    tile_width = 0
    tile_height = 0

    rows = 0
    cols = 0
    
    layout = ''
    
    # row major, 1 channel per pixel
    data = []
    
    def __init__(self, width=0, height=0, filename=None):
        if width == 0:
            tmp = png.Reader(filename=filename).asRGBA8()
            self.width = tmp[0]
            self.height = tmp[1]
            self.data = [row[::4] for row in tmp[2]]
            self.data = [j for i in self.data for j in i]
        else:
            self.width = width
            self.height = height
            self.data = [0] * (width * height)
            

    def save(self, filename):
        # pypng requires a 2D array
        array = [None] * self.height
        for y in range(0, self.height):
            i = y * self.width
            array[y] = self.data[i:(i + self.width)]

        # pypng can only save once from an image (!), so creating a
        # new one on each call is actually the best we could do
        png.from_array(array, 'L').save(filename)


    def copy_tiles(self, dst_x, dst_y, src, src_x, src_y, width = 1, height = 1, operator = None):
        self.copy(dst_x * self.tile_width, dst_y * self.tile_height, src, src_x * src.tile_width, src_y * src.tile_height, src.tile_width * width, src.tile_height * height, operator)

        
    def copy(self, dst_x, dst_y, src, src_x, src_y, width = None, height = None, operator = None):
        if width == None: width = self.tile_width
        if height == None: height = self.tile_height
        
        for y in range(0, height):
            s = (src_y + y) * src.width + src_x
            d = (dst_y + y) * self.width + dst_x
            if operator == None:
                # Copy
                self.data[d : d + width] = src.data[s : s + width]
            else:
                self.data[d : d + width] = map(operator, self.data[d : d + width], src.data[s : s + width])

        
OLD_LAYOUT = """
ABCDEFGHIJKLMNOPQRSTUVWXYZ↑↓;:,.
abcdefghijklmnopqrstuvwxyz←→<>◀▶
0123456789+-()~!@#$%^&*_=?¥€£¬∩∪
⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾ᵃᵝⁱʲˣᵏᵘⁿ≟≠≤≥≈{}[]★
ᵈᵉʰᵐᵒʳˢᵗⓌⒶⓈⒹⒾⒿⓀⓁ⍐⍇⍗⍈ⓛⓡ▼∈∞°¼½¾⅓⅔⅕
«»ΓΔмнкΘ¿¡Λ⊢∙Ξ×ΠİΣ♆ℵΦ©ΨΩ∅ŞĞ\\/|`'
αβγδεζηθικλμνξ§πρστυϕχψωςşğ⌊⌋⌈⌉"
ÆÀÁÂÃÄÅÇÈÉÊËÌÍÎÏØÒÓÔÕÖŒÑẞÙÚÛÜБ✓Д
æàáâãäåçèéêëìíîïøòóôõöœñßùúûüбгд
ЖЗИЙЛПЦЧШЩЭЮЯЪЫЬ±⊗↖↗втⓔ⦸ⓝⓗ○●◻◼△▲
жзийлпцчшщэюяъыь∫❖↙↘…‖ʸᶻⓩ⑤⑥♠♥♣♦✜
ⓐⓑⓒⓓⓕⓖⓟⓠⓥⓧⓨ⬙⬗⬖⬘Ⓞ⍍▣⧉☰⒧⒭①②③④⑦⑧⑨⓪⊖⊕
␣Ɛ⏎ҕﯼડƠ⇥
⬁⬀⌥     """[1:]

NEW_LAYOUT = '''
ABCDEFGHIJKLMNOPQRSTUVWXYZ↑↓;:,.
abcdefghijklmnopqrstuvwxyz←→<>`'
0123456789+-()~!@#$%^&*_=?¼½¾⅓⅔⅕
⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾ᵃᵝᵈᵉʰⁱʲᵏᵐⁿᵒʳˢᵗᵘˣʸᶻ
αβγδεζηθικλμνξ§πρστυϕχψωςΓΔΘΛΞΠİ
‘ÀàÈèÒòÌìÙùŁłŚŠŞśšşØẞБДҐΣΦΨΩ{}[]
´ÁáÉéÓóÍíÚúĆćŽžŹźŻżøßбдґ©\\/|⌈⌉⌊⌋
ˆÂâÊêÔôÎîÛûÑñЖЗИЙЛПЦЧШЩЄЭЮЯЪЫЬÆŒ
̈ÄäËëÖöÏïÜüŃńжзийлпцчшщєэюяъыьæœ
˚ÅåŘřĎďÝýŮůŇň±⊗↖↗ ○●◻◼△▲▼◀▶внкмт
˜ÃãĘęÕõЎўÇç¥€∫❖↙↘…‖♠♥♣♦✜★∞∅«»°∩∪
ˇĄąĚěŤťĞğČč£✓г≟≠≤≥≈"¿¡¬⊢∙×∈♆ℵ   
■ⓆⓏⓌⒶⓈⒹⒾⒿⓀⓁ⍐⍇⍗⍈ⓛⓡ①②③④⑤⑥⑦⑧⑨⓪⊖⊕⓵⒜ 
◉ⓐⓑⓒⓓⓔ⓷ⓕⓖⓗⓜⓝⓟⓠⓤⓥⓧⓨⓩ⦸⬙⬗⬖⬘Ⓞ⍍▣⧉☰⒧⒭ 
␣Ɛ⏎ҕﯼડƠ⇥
⬁⬀⌥     '''[1:]

            
# Return the char at (x, y)
def layout_char(x, y, layout):
    cols = layout.index('\n')
    i = x + (cols + 1) * y
    return layout[i]


# Returns (tile_x, tile_y). If not found throws ValueError
def find_tile(layout, char):
    cols = layout.index('\n')
    i = layout.index(char)
    return (i % (cols + 1), math.floor(i / (cols + 1)))


def font_update(filename_base):
    meta = workjson.load(filename_base + '.font.json')
    if 'format' in meta:
        print('Cannot update ' + filename_base + '.font.json because is already in the new format')
        return
    else:
        print(filename_base + '.font.json')
    
    # update the format
    meta['format'] = '20211015'

    src = Image(filename=filename_base + '.png')
    src.layout = OLD_LAYOUT
    src.cols = src.layout.index('\n')
    src.rows = src.layout.count('\n') + 1
    src.tile_width = math.floor(src.width / src.cols)
    src.tile_height = math.floor(src.height / src.rows)


    NEW_FONT_COLS = NEW_LAYOUT.index('\n')
    NEW_FONT_ROWS = NEW_LAYOUT.count('\n') + 1
    NEW_FONT_SPECIAL_ROWS = 2
    dst = Image(NEW_FONT_COLS * src.tile_width,
                NEW_FONT_ROWS * src.tile_height)
    dst.layout = NEW_LAYOUT
    dst.cols = NEW_FONT_COLS
    dst.rows = NEW_FONT_ROWS
    dst.tile_width = src.tile_width
    dst.tile_height = src.tile_height

    for dst_tile_y in range(0, dst.rows - NEW_FONT_SPECIAL_ROWS):
        for dst_tile_x in range(0, dst.cols):
            char = layout_char(dst_tile_x, dst_tile_y, dst.layout)
            if char != ' ':
                try:
                    (src_tile_x, src_tile_y) = find_tile(src.layout, char)
                    dst.copy_tiles(dst_tile_x, dst_tile_y, src, src_tile_x, src_tile_y)
                except ValueError:
                    pass

    # Copy the last two rows.
    dst.copy_tiles(0, dst.rows - 2, src, 0, src.rows - 2, src.cols, 2)

    # Generate new required characters. The others can be produced on load

    # Create the filled circle
    (dst_tile_x, dst_tile_y) = find_tile(dst.layout, '◉')
    for i in range(1, 32):
        dst.copy_tiles(dst_tile_x, dst_tile_y, dst, dst_tile_x + i, dst_tile_y, 1, 1, operator.or_)

    # Create the filled square
    (dst_tile_x, dst_tile_y) = find_tile(dst.layout, '■')
    for i in range(3, 14):
        dst.copy_tiles(dst_tile_x, dst_tile_y, dst, dst_tile_x + i, dst_tile_y, 1, 1, operator.or_)

    # Generate the accents poorly but as a rough start
    dst.copy_tiles(*find_tile(dst.layout, 'ˆ'), dst, *find_tile(dst.layout, '^'))
    dst.copy_tiles(*find_tile(dst.layout, '‘'), dst, *find_tile(dst.layout, '`'))
    dst.copy_tiles(*find_tile(dst.layout, '˚'), dst, *find_tile(dst.layout, '°'))
    dst.copy_tiles(*find_tile(dst.layout, '˜'), dst, *find_tile(dst.layout, '~'))

    # Ⓠ
    dst.copy_tiles(*find_tile(dst.layout, 'Ⓠ'), dst, *find_tile(dst.layout, '■'))
    dst.copy_tiles(*find_tile(dst.layout, 'Ⓠ'), dst, *find_tile(dst.layout, 'Q'), 1, 1, operator.xor)

    # Ⓩ
    dst.copy_tiles(*find_tile(dst.layout, 'Ⓩ'), dst, *find_tile(dst.layout, '■'))
    dst.copy_tiles(*find_tile(dst.layout, 'Ⓩ'), dst, *find_tile(dst.layout, 'Z'), 1, 1, operator.xor)

    # ⓷
    dst.copy_tiles(*find_tile(dst.layout, '⓷'), dst, *find_tile(dst.layout, '◉'))
    dst.copy_tiles(*find_tile(dst.layout, '⓷'), dst, *find_tile(dst.layout, 'è'), 1, 1, operator.xor)

    # ⒜
    dst.copy_tiles(*find_tile(dst.layout, '⒜'), dst, *find_tile(dst.layout, '◉'))
    dst.copy_tiles(*find_tile(dst.layout, '⒜'), dst, *find_tile(dst.layout, 'à'), 1, 1, operator.xor)

    # ⓤ
    dst.copy_tiles(*find_tile(dst.layout, 'ⓤ'), dst, *find_tile(dst.layout, '◉'))
    dst.copy_tiles(*find_tile(dst.layout, 'ⓤ'), dst, *find_tile(dst.layout, 'ù'), 1, 1, operator.xor)

    # ⓵
    dst.copy_tiles(*find_tile(dst.layout, '⓵'), dst, *find_tile(dst.layout, '◉'))
    dst.copy_tiles(*find_tile(dst.layout, '⓵'), dst, *find_tile(dst.layout, '!'), 1, 1, operator.xor)

    # ⓜ
    dst.copy_tiles(*find_tile(dst.layout, 'ⓜ'), dst, *find_tile(dst.layout, '◉'))
    dst.copy_tiles(*find_tile(dst.layout, 'ⓜ'), dst, *find_tile(dst.layout, 'm'), 1, 1, operator.xor)


    dst.save(filename_base + '.png')
    workjson.dump(filename_base + '.font.json', meta, indent=4)


if len(sys.argv) == 1 or sys.argv[1] == '--help':
    print('python3 font-update.py <filename.png> ...')
    sys.exit(0)
else:
    for filename in sys.argv[1:]:
        if filename.endswith('.png'):
            font_update(filename[:-4])
        else:
            print('Bad font png filename: ', filename)
