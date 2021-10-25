'\nThe ``png`` module can read and write PNG files.\n\nInstallation and Overview\n-------------------------\n\n``pip install pypng``\n\nFor help, type ``import png; help(png)`` in your python interpreter.\n\nA good place to start is the :class:`Reader` and :class:`Writer` classes.\n\nCoverage of PNG formats is fairly complete;\nall allowable bit depths (1/2/4/8/16/24/32/48/64 bits per pixel) and\ncolour combinations are supported:\n\n- greyscale (1/2/4/8/16 bit);\n- RGB, RGBA, LA (greyscale with alpha) with 8/16 bits per channel;\n- colour mapped images (1/2/4/8 bit).\n\nInterlaced images,\nwhich support a progressive display when downloading,\nare supported for both reading and writing.\n\nA number of optional chunks can be specified (when writing)\nand understood (when reading): ``tRNS``, ``bKGD``, ``gAMA``.\n\nThe ``sBIT`` chunk can be used to specify precision for\nnon-native bit depths.\n\nRequires Python 3.5 or higher.\nInstallation is trivial,\nbut see the ``README.txt`` file (with the source distribution) for details.\n\nFull use of all features will need some reading of the PNG specification\nhttp://www.w3.org/TR/2003/REC-PNG-20031110/.\n\nThe package also comes with command line utilities.\n\n- ``pripamtopng`` converts\n  `Netpbm <http://netpbm.sourceforge.net/>`_ PAM/PNM files to PNG;\n- ``pripngtopam`` converts PNG to file PAM/PNM.\n\nThere are a few more for simple PNG manipulations.\n\nSpelling and Terminology\n------------------------\n\nGenerally British English spelling is used in the documentation.\nSo that\'s "greyscale" and "colour".\nThis not only matches the author\'s native language,\nit\'s also used by the PNG specification.\n\nColour Models\n-------------\n\nThe major colour models supported by PNG (and hence by PyPNG) are:\n\n- greyscale;\n- greyscale--alpha;\n- RGB;\n- RGB--alpha.\n\nAlso referred to using the abbreviations: L, LA, RGB, RGBA.\nEach letter codes a single channel:\n*L* is for Luminance or Luma or Lightness (greyscale images);\n*A* stands for Alpha, the opacity channel\n(used for transparency effects, but higher values are more opaque,\nso it makes sense to call it opacity);\n*R*, *G*, *B* stand for Red, Green, Blue (colour image).\n\nLists, arrays, sequences, and so on\n-----------------------------------\n\nWhen getting pixel data out of this module (reading) and\npresenting data to this module (writing) there are\na number of ways the data could be represented as a Python value.\n\nThe preferred format is a sequence of *rows*,\nwhich each row being a sequence of *values*.\nIn this format, the values are in pixel order,\nwith all the values from all the pixels in a row\nbeing concatenated into a single sequence for that row.\n\nConsider an image that is 3 pixels wide by 2 pixels high, and each pixel\nhas RGB components:\n\nSequence of rows::\n\n  list([R,G,B, R,G,B, R,G,B],\n       [R,G,B, R,G,B, R,G,B])\n\nEach row appears as its own list,\nbut the pixels are flattened so that three values for one pixel\nsimply follow the three values for the previous pixel.\n\nThis is the preferred because\nit provides a good compromise between space and convenience.\nPyPNG regards itself as at liberty to replace any sequence type with\nany sufficiently compatible other sequence type;\nin practice each row is an array (``bytearray`` or ``array.array``).\n\nTo allow streaming the outer list is sometimes\nan iterator rather than an explicit list.\n\nAn alternative format is a single array holding all the values.\n\nArray of values::\n\n  [R,G,B, R,G,B, R,G,B,\n   R,G,B, R,G,B, R,G,B]\n\nThe entire image is one single giant sequence of colour values.\nGenerally an array will be used (to save space), not a list.\n\nThe top row comes first,\nand within each row the pixels are ordered from left-to-right.\nWithin a pixel the values appear in the order R-G-B-A\n(or L-A for greyscale--alpha).\n\nThere is another format, which should only be used with caution.\nIt is mentioned because it is used internally,\nis close to what lies inside a PNG file itself,\nand has some support from the public API.\nThis format is called *packed*.\nWhen packed, each row is a sequence of bytes (integers from 0 to 255),\njust as it is before PNG scanline filtering is applied.\nWhen the bit depth is 8 this is the same as a sequence of rows;\nwhen the bit depth is less than 8 (1, 2 and 4),\nseveral pixels are packed into each byte;\nwhen the bit depth is 16 each pixel value is decomposed into 2 bytes\n(and `packed` is a misnomer).\nThis format is used by the :meth:`Writer.write_packed` method.\nIt isn\'t usually a convenient format,\nbut may be just right if the source data for\nthe PNG image comes from something that uses a similar format\n(for example, 1-bit BMPs, or another PNG file).\n'
_L=b'IEND'
_K='!%dH'
_J=b'IDAT'
_I='!I'
_H=True
_G='planes'
_F='BH'
_E='alpha'
_D='greyscale'
_C=False
_B='bitdepth'
_A=None
__version__='0.0.21'
import collections,io,itertools,math,operator,re,struct,sys,warnings,zlib
from array import array
__all__=['Image','Reader','Writer','write_chunks','from_array']
signature=struct.pack('8B',137,80,78,71,13,10,26,10)
adam7=(0,0,8,8),(4,0,8,8),(0,4,4,8),(2,0,4,4),(0,2,2,4),(1,0,2,2),(0,1,1,2)
def adam7_generate(width,height):
	'\n    Generate the coordinates for the reduced scanlines\n    of an Adam7 interlaced image\n    of size `width` by `height` pixels.\n\n    Yields a generator for each pass,\n    and each pass generator yields a series of (x, y, xstep) triples,\n    each one identifying a reduced scanline consisting of\n    pixels starting at (x, y) and taking every xstep pixel to the right.\n    '
	for (A,B,C,D) in adam7:
		if A>=width:continue
		yield((A,E,C)for E in range(B,height,D))
Resolution=collections.namedtuple('_Resolution','x y unit_is_meter')
def group(s,n):return list(zip(*[iter(s)]*n))
def isarray(x):return isinstance(x,array)
def check_palette(palette):
	'\n    Check a palette argument (to the :class:`Writer` class) for validity.\n    Returns the palette as a list if okay;\n    raises an exception otherwise.\n    ';E=palette
	if E is _A:return _A
	B=list(E)
	if not 0<len(B)<=256:raise ProtocolError('a palette must have between 1 and 256 entries, see https://www.w3.org/TR/PNG/#11PLTE')
	F=_C
	for (C,A) in enumerate(B):
		if len(A)not in(3,4):raise ProtocolError('palette entry %d: entries must be 3- or 4-tuples.'%C)
		if len(A)==3:F=_H
		if F and len(A)==4:raise ProtocolError('palette entry %d: all 4-tuples must precede all 3-tuples'%C)
		for D in A:
			if int(D)!=D or not 0<=D<=255:raise ProtocolError('palette entry %d: values must be integer: 0 <= x <= 255'%C)
	return B
def check_sizes(size,width,height):
	'\n    Check that these arguments, if supplied, are consistent.\n    Return a (width, height) pair.\n    ';C=height;B=width;A=size
	if not A:return B,C
	if len(A)!=2:raise ProtocolError('size argument should be a pair (width, height)')
	if B is not _A and B!=A[0]:raise ProtocolError('size[0] (%r) and width (%r) should match when both are used.'%(A[0],B))
	if C is not _A and C!=A[1]:raise ProtocolError('size[1] (%r) and height (%r) should match when both are used.'%(A[1],C))
	return A
def check_color(c,greyscale,which):
	'\n    Checks that a colour argument for transparent or background options\n    is the right form.\n    Returns the colour\n    (which, if it\'s a bare integer, is "corrected" to a 1-tuple).\n    ';A=which
	if c is _A:return c
	if greyscale:
		try:len(c)
		except TypeError:c=c,
		if len(c)!=1:raise ProtocolError('%s for greyscale must be 1-tuple'%A)
		if not is_natural(c[0]):raise ProtocolError('%s colour for greyscale must be integer'%A)
	elif not(len(c)==3 and is_natural(c[0])and is_natural(c[1])and is_natural(c[2])):raise ProtocolError('%s colour must be a triple of integers'%A)
	return c
class Error(Exception):
	def __str__(A):return A.__class__.__name__+': '+' '.join(A.args)
class FormatError(Error):'\n    Problem with input file format.\n    In other words, PNG file does not conform to\n    the specification in some way and is invalid.\n    '
class ProtocolError(Error):'\n    Problem with the way the programming interface has been used,\n    or the data presented to it.\n    '
class ChunkError(FormatError):0
class Default:'The default for the greyscale parameter.'
class Writer:
	'\n    PNG encoder in pure Python.\n    '
	def __init__(A,width=_A,height=_A,size=_A,greyscale=Default,alpha=_C,bitdepth=8,palette=_A,transparent=_A,background=_A,gamma=_A,compression=_A,interlace=_C,planes=_A,colormap=_A,maxval=_A,chunk_limit=2**20,x_pixels_per_unit=_A,y_pixels_per_unit=_A,unit_is_meter=_C):
		"\n        Create a PNG encoder object.\n\n        Arguments:\n\n        width, height\n          Image size in pixels, as two separate arguments.\n        size\n          Image size (w,h) in pixels, as single argument.\n        greyscale\n          Pixels are greyscale, not RGB.\n        alpha\n          Input data has alpha channel (RGBA or LA).\n        bitdepth\n          Bit depth: from 1 to 16 (for each channel).\n        palette\n          Create a palette for a colour mapped image (colour type 3).\n        transparent\n          Specify a transparent colour (create a ``tRNS`` chunk).\n        background\n          Specify a default background colour (create a ``bKGD`` chunk).\n        gamma\n          Specify a gamma value (create a ``gAMA`` chunk).\n        compression\n          zlib compression level: 0 (none) to 9 (more compressed);\n          default: -1 or None.\n        interlace\n          Create an interlaced image.\n        chunk_limit\n          Write multiple ``IDAT`` chunks to save memory.\n        x_pixels_per_unit\n          Number of pixels a unit along the x axis (write a\n          `pHYs` chunk).\n        y_pixels_per_unit\n          Number of pixels a unit along the y axis (write a\n          `pHYs` chunk). Along with `x_pixel_unit`, this gives\n          the pixel size ratio.\n        unit_is_meter\n          `True` to indicate that the unit (for the `pHYs`\n          chunk) is metre.\n\n        The image size (in pixels) can be specified either by using the\n        `width` and `height` arguments, or with the single `size`\n        argument.\n        If `size` is used it should be a pair (*width*, *height*).\n\n        The `greyscale` argument indicates whether input pixels\n        are greyscale (when true), or colour (when false).\n        The default is true unless `palette=` is used.\n\n        The `alpha` argument (a boolean) specifies\n        whether input pixels have an alpha channel (or not).\n\n        `bitdepth` specifies the bit depth of the source pixel values.\n        Each channel may have a different bit depth.\n        Each source pixel must have values that are\n        an integer between 0 and ``2**bitdepth-1``, where\n        `bitdepth` is the bit depth for the corresponding channel.\n        For example, 8-bit images have values between 0 and 255.\n        PNG only stores images with bit depths of\n        1,2,4,8, or 16 (the same for all channels).\n        When `bitdepth` is not one of these values or where\n        channels have different bit depths,\n        the next highest valid bit depth is selected,\n        and an ``sBIT`` (significant bits) chunk is generated\n        that specifies the original precision of the source image.\n        In this case the supplied pixel values will be rescaled to\n        fit the range of the selected bit depth.\n\n        The PNG file format supports many bit depth / colour model\n        combinations, but not all.\n        The details are somewhat arcane\n        (refer to the PNG specification for full details).\n        Briefly:\n        Bit depths < 8 (1,2,4) are only allowed with greyscale and\n        colour mapped images;\n        colour mapped images cannot have bit depth 16.\n\n        For colour mapped images\n        (in other words, when the `palette` argument is specified)\n        the `bitdepth` argument must match one of\n        the valid PNG bit depths: 1, 2, 4, or 8.\n        (It is valid to have a PNG image with a palette and\n        an ``sBIT`` chunk, but the meaning is slightly different;\n        it would be awkward to use the `bitdepth` argument for this.)\n\n        The `palette` option, when specified,\n        causes a colour mapped image to be created:\n        the PNG colour type is set to 3;\n        `greyscale` must not be true; `alpha` must not be true;\n        `transparent` must not be set.\n        The bit depth must be 1,2,4, or 8.\n        When a colour mapped image is created,\n        the pixel values are palette indexes and\n        the `bitdepth` argument specifies the size of these indexes\n        (not the size of the colour values in the palette).\n\n        The palette argument value should be a sequence of 3- or\n        4-tuples.\n        3-tuples specify RGB palette entries;\n        4-tuples specify RGBA palette entries.\n        All the 4-tuples (if present) must come before all the 3-tuples.\n        A ``PLTE`` chunk is created;\n        if there are 4-tuples then a ``tRNS`` chunk is created as well.\n        The ``PLTE`` chunk will contain all the RGB triples in the same\n        sequence;\n        the ``tRNS`` chunk will contain the alpha channel for\n        all the 4-tuples, in the same sequence.\n        Palette entries are always 8-bit.\n\n        If specified, the `transparent` and `background` parameters must be\n        a tuple with one element for each channel in the image.\n        Either a 3-tuple of integer (RGB) values for a colour image, or\n        a 1-tuple of a single integer for a greyscale image.\n\n        If specified, the `gamma` parameter must be a positive number\n        (generally, a `float`).\n        A ``gAMA`` chunk will be created.\n        Note that this will not change the values of the pixels as\n        they appear in the PNG file,\n        they are assumed to have already\n        been converted appropriately for the gamma specified.\n\n        The `compression` argument specifies the compression level to\n        be used by the ``zlib`` module.\n        Values from 1 to 9 (highest) specify compression.\n        0 means no compression.\n        -1 and ``None`` both mean that the ``zlib`` module uses\n        the default level of compression (which is generally acceptable).\n\n        If `interlace` is true then an interlaced image is created\n        (using PNG's so far only interlace method, *Adam7*).\n        This does not affect how the pixels should be passed in,\n        rather it changes how they are arranged into the PNG file.\n        On slow connexions interlaced images can be\n        partially decoded by the browser to give\n        a rough view of the image that is\n        successively refined as more image data appears.\n\n        .. note ::\n\n          Enabling the `interlace` option requires the entire image\n          to be processed in working memory.\n\n        `chunk_limit` is used to limit the amount of memory used whilst\n        compressing the image.\n        In order to avoid using large amounts of memory,\n        multiple ``IDAT`` chunks may be created.\n        ";K=colormap;J=background;I=planes;H=transparent;G=height;F=width;E=alpha;D=palette;C=greyscale;B=bitdepth;F,G=check_sizes(size,F,G);del size
		if not is_natural(F)or not is_natural(G):raise ProtocolError('width and height must be integers')
		if F<=0 or G<=0:raise ProtocolError('width and height must be greater than zero')
		if F>2**31-1 or G>2**31-1:raise ProtocolError('width and height cannot exceed 2**31-1')
		if E and H is not _A:raise ProtocolError('transparent colour not allowed with alpha channel')
		try:len(B)
		except TypeError:B=B,
		for M in B:
			N=is_natural(M)and 1<=M<=16
			if not N:raise ProtocolError('each bitdepth %r must be a positive integer <= 16'%(B,))
		D=check_palette(D);E=bool(E);K=bool(D)
		if C is Default and D:C=_C
		C=bool(C)
		if K:L=1;I=1
		else:L=(3,1)[C];I=L+E
		if len(B)==1:B*=I
		B,A.rescale=check_bitdepth_rescale(D,B,H,E,C)
		if B<8:assert C or D;assert not E
		if B>8:assert not D
		H=check_color(H,C,'transparent');J=check_color(J,C,'background');A.width=F;A.height=G;A.transparent=H;A.background=J;A.gamma=gamma;A.greyscale=C;A.alpha=E;A.colormap=K;A.bitdepth=int(B);A.compression=compression;A.chunk_limit=chunk_limit;A.interlace=bool(interlace);A.palette=D;A.x_pixels_per_unit=x_pixels_per_unit;A.y_pixels_per_unit=y_pixels_per_unit;A.unit_is_meter=bool(unit_is_meter);A.color_type=4*A.alpha+2*(not C)+1*A.colormap;assert A.color_type in(0,2,3,4,6);A.color_planes=L;A.planes=I;A.psize=A.bitdepth/8*A.planes
	def write(A,outfile,rows):
		'\n        Write a PNG image to the output file.\n        `rows` should be an iterable that yields each row\n        (each row is a sequence of values).\n        The rows should be the rows of the original image,\n        so there should be ``self.height`` rows of\n        ``self.width * self.planes`` values.\n        If `interlace` is specified (when creating the instance),\n        then an interlaced PNG file will be written.\n        Supply the rows in the normal image order;\n        the interlacing is carried out internally.\n\n        .. note ::\n\n          Interlacing requires the entire image to be in working memory.\n        ';C=outfile;D=A.width*A.planes
		def E(rows):
			'\n            Yield each row in rows,\n            but check each row first (for correct width).\n            '
			for (C,A) in enumerate(rows):
				try:B=len(A)!=D
				except TypeError:B=_C
				if B:raise ProtocolError('Expected %d values but got %d values, in row %d'%(D,len(A),C))
				yield A
		if A.interlace:F=_F[A.bitdepth>8];G=array(F,itertools.chain(*E(rows)));return A.write_array(C,G)
		B=A.write_passes(C,E(rows))
		if B!=A.height:raise ProtocolError('rows supplied (%d) does not match height (%d)'%(B,A.height))
		return B
	def write_passes(B,outfile,rows):
		'\n        Write a PNG image to the output file.\n\n        Most users are expected to find the :meth:`write` or\n        :meth:`write_array` method more convenient.\n\n        The rows should be given to this method in the order that\n        they appear in the output file.\n        For straightlaced images, this is the usual top to bottom ordering.\n        For interlaced images the rows should have been interlaced before\n        passing them to this function.\n\n        `rows` should be an iterable that yields each row\n        (each row being a sequence of values).\n        ';A=rows
		if B.rescale:A=rescale_rows(A,B.rescale)
		if B.bitdepth<8:A=pack_rows(A,B.bitdepth)
		elif B.bitdepth==16:A=unpack_rows(A)
		return B.write_packed(outfile,A)
	def write_packed(C,outfile,rows):
		'\n        Write PNG file to `outfile`.\n        `rows` should be an iterator that yields each packed row;\n        a packed row being a sequence of packed bytes.\n\n        The rows have a filter byte prefixed and\n        are then compressed into one or more IDAT chunks.\n        They are not processed any further,\n        so if bitdepth is other than 1, 2, 4, 8, 16,\n        the pixel values should have been scaled\n        before passing them to this method.\n\n        This method does work for interlaced images but it is best avoided.\n        For interlaced images, the rows should be\n        presented in the order that they appear in the file.\n        ';D=outfile;C.write_preamble(D)
		if C.compression is not _A:E=zlib.compressobj(C.compression)
		else:E=zlib.compressobj()
		A=bytearray();F=-1
		for (F,H) in enumerate(rows):
			A.append(0);A.extend(H)
			if len(A)>C.chunk_limit:
				B=E.compress(A)
				if len(B):write_chunk(D,_J,B)
				A=bytearray()
		B=E.compress(bytes(A));G=E.flush()
		if len(B)or len(G):write_chunk(D,_J,B+G)
		write_chunk(D,_L);return F+1
	def write_preamble(A,outfile):
		G='!3H';F='!1H';E=b'tRNS';B=outfile;B.write(signature);write_chunk(B,b'IHDR',struct.pack('!2I5B',A.width,A.height,A.bitdepth,A.color_type,0,0,A.interlace))
		if A.gamma is not _A:write_chunk(B,b'gAMA',struct.pack('!L',int(round(A.gamma*100000.0))))
		if A.rescale:write_chunk(B,b'sBIT',struct.pack('%dB'%A.planes,*([B[0]for B in A.rescale])))
		if A.palette:
			H,D=make_palette_chunks(A.palette);write_chunk(B,b'PLTE',H)
			if D:write_chunk(B,E,D)
		if A.transparent is not _A:
			if A.greyscale:C=F
			else:C=G
			write_chunk(B,E,struct.pack(C,*A.transparent))
		if A.background is not _A:
			if A.greyscale:C=F
			else:C=G
			write_chunk(B,b'bKGD',struct.pack(C,*A.background))
		if A.x_pixels_per_unit is not _A and A.y_pixels_per_unit is not _A:I=A.x_pixels_per_unit,A.y_pixels_per_unit,int(A.unit_is_meter);write_chunk(B,b'pHYs',struct.pack('!LLB',*(I)))
	def write_array(A,outfile,pixels):
		'\n        Write an array that holds all the image values\n        as a PNG file on the output file.\n        See also :meth:`write` method.\n        ';C=outfile;B=pixels
		if A.interlace:
			if type(B)!=array:D=_F[A.bitdepth>8];B=array(D,B)
			return A.write_passes(C,A.array_scanlines_interlace(B))
		else:return A.write_passes(C,A.array_scanlines(B))
	def array_scanlines(A,pixels):
		'\n        Generates rows (each a sequence of values) from\n        a single array of values.\n        ';D=A.width*A.planes;B=0
		for E in range(A.height):C=B;B=C+D;yield pixels[C:B]
	def array_scanlines_interlace(A,pixels):
		'\n        Generator for interlaced scanlines from an array.\n        `pixels` is the full source image as a single array of values.\n        The generator yields each scanline of the reduced passes in turn,\n        each scanline being a sequence of values.\n        ';D=pixels;J=_F[A.bitdepth>8];B=A.width*A.planes
		for K in adam7_generate(A.width,A.height):
			for (H,E,F) in K:
				L=int(math.ceil((A.width-H)/float(F)));M=L*A.planes
				if F==1:C=E*B;yield D[C:C+B];continue
				G=array(J);G.extend(D[0:M]);C=E*B+H*A.planes;N=(E+1)*B;O=A.planes*F
				for I in range(A.planes):G[I::A.planes]=D[C+I:N:O]
				yield G
def write_chunk(outfile,tag,data=b''):'\n    Write a PNG chunk to the output file, including length and\n    checksum.\n    ';B=outfile;A=data;A=bytes(A);B.write(struct.pack(_I,len(A)));B.write(tag);B.write(A);C=zlib.crc32(tag);C=zlib.crc32(A,C);C&=2**32-1;B.write(struct.pack(_I,C))
def write_chunks(out,chunks):
	'Create a PNG file by writing out the chunks.';out.write(signature)
	for A in chunks:write_chunk(out,*(A))
def rescale_rows(rows,rescale):
	'\n    Take each row in rows (an iterator) and yield\n    a fresh row with the pixels scaled according to\n    the rescale parameters in the list `rescale`.\n    Each element of `rescale` is a tuple of\n    (source_bitdepth, target_bitdepth),\n    with one element per channel.\n    ';A=rescale;H=[float(2**B[1]-1)/float(2**B[0]-1)for B in A];D=set((B[1]for B in A));assert len(D)==1;I,=D;E=_F[I>8];B=len(A)
	for F in rows:
		G=array(E,iter(F))
		for C in range(B):J=array(E,(int(round(H[C]*A))for A in F[C::B]));G[C::B]=J
		yield G
def pack_rows(rows,bitdepth):
	'Yield packed rows that are a byte array.\n    Each byte is packed with the values from several pixels.\n    ';A=bitdepth;assert A<8;assert 8%A==0;B=int(8/A)
	def E(block):
		'Take a block of (2, 4, or 8) values,\n        and pack them into a single byte.\n        ';B=0
		for C in block:B=(B<<A)+C
		return B
	for F in rows:C=bytearray(F);D=float(len(C));G=math.ceil(D/B)*B-D;C.extend([0]*int(G));H=group(C,B);yield bytearray((E(A)for A in H))
def unpack_rows(rows):
	'Unpack each row from being 16-bits per value,\n    to being a sequence of bytes.\n    '
	for A in rows:B=_K%len(A);yield bytearray(struct.pack(B,*(A)))
def make_palette_chunks(palette):
	'\n    Create the byte sequences for a ``PLTE`` and\n    if necessary a ``tRNS`` chunk.\n    Returned as a pair (*p*, *t*).\n    *t* will be ``None`` if no ``tRNS`` chunk is necessary.\n    ';A=bytearray();B=bytearray()
	for C in palette:
		A.extend(C[0:3])
		if len(C)>3:B.append(C[3])
	if B:return A,B
	return A,_A
def check_bitdepth_rescale(palette,bitdepth,transparent,alpha,greyscale):
	'\n    Returns (bitdepth, rescale) pair.\n    ';D=greyscale;C=alpha;A=bitdepth
	if palette:
		if len(A)!=1:raise ProtocolError('with palette, only a single bitdepth may be used')
		A,=A
		if A not in(1,2,4,8):raise ProtocolError('with palette, bitdepth must be 1, 2, 4, or 8')
		if transparent is not _A:raise ProtocolError('transparent and palette not compatible')
		if C:raise ProtocolError('alpha and palette not compatible')
		if D:raise ProtocolError('greyscale and palette not compatible')
		return A,_A
	if D and not C:
		A,=A
		if A in(1,2,4,8,16):return A,_A
		if A>8:B=16
		elif A==3:B=4
		else:assert A in(5,6,7);B=8
		return B,[(A,B)]
	assert C or not D;E=tuple(set(A))
	if E in[(8,),(16,)]:A,=E;return A,_A
	B=(8,16)[max(A)>8];return B,[(C,B)for C in A]
RegexModeDecode=re.compile('(LA?|RGBA?);?([0-9]*)',flags=re.IGNORECASE)
def from_array(a,mode=_A,info={}):
	"\n    Create a PNG :class:`Image` object from a 2-dimensional array.\n    One application of this function is easy PIL-style saving:\n    ``png.from_array(pixels, 'L').save('foo.png')``.\n\n    Unless they are specified using the *info* parameter,\n    the PNG's height and width are taken from the array size.\n    The first axis is the height; the second axis is the\n    ravelled width and channel index.\n    The array is treated is a sequence of rows,\n    each row being a sequence of values (``width*channels`` in number).\n    So an RGB image that is 16 pixels high and 8 wide will\n    occupy a 2-dimensional array that is 16x24\n    (each row will be 8*3 = 24 sample values).\n\n    *mode* is a string that specifies the image colour format in a\n    PIL-style mode.  It can be:\n\n    ``'L'``\n      greyscale (1 channel)\n    ``'LA'``\n      greyscale with alpha (2 channel)\n    ``'RGB'``\n      colour image (3 channel)\n    ``'RGBA'``\n      colour image with alpha (4 channel)\n\n    The mode string can also specify the bit depth\n    (overriding how this function normally derives the bit depth,\n    see below).\n    Appending ``';16'`` to the mode will cause the PNG to be\n    16 bits per channel;\n    any decimal from 1 to 16 can be used to specify the bit depth.\n\n    When a 2-dimensional array is used *mode* determines how many\n    channels the image has, and so allows the width to be derived from\n    the second array dimension.\n\n    The array is expected to be a ``numpy`` array,\n    but it can be any suitable Python sequence.\n    For example, a list of lists can be used:\n    ``png.from_array([[0, 255, 0], [255, 0, 255]], 'L')``.\n    The exact rules are: ``len(a)`` gives the first dimension, height;\n    ``len(a[0])`` gives the second dimension.\n    It's slightly more complicated than that because\n    an iterator of rows can be used, and it all still works.\n    Using an iterator allows data to be streamed efficiently.\n\n    The bit depth of the PNG is normally taken from\n    the array element's datatype\n    (but if *mode* specifies a bitdepth then that is used instead).\n    The array element's datatype is determined in a way which\n    is supposed to work both for ``numpy`` arrays and for Python\n    ``array.array`` objects.\n    A 1 byte datatype will give a bit depth of 8,\n    a 2 byte datatype will give a bit depth of 16.\n    If the datatype does not have an implicit size,\n    like the above example where it is a plain Python list of lists,\n    then a default of 8 is used.\n\n    The *info* parameter is a dictionary that can\n    be used to specify metadata (in the same style as\n    the arguments to the :class:`png.Writer` class).\n    For this function the keys that are useful are:\n\n    height\n      overrides the height derived from the array dimensions and\n      allows *a* to be an iterable.\n    width\n      overrides the width derived from the array dimensions.\n    bitdepth\n      overrides the bit depth derived from the element datatype\n      (but must match *mode* if that also specifies a bit depth).\n\n    Generally anything specified in the *info* dictionary will\n    override any implicit choices that this function would otherwise make,\n    but must match any explicit ones.\n    For example, if the *info* dictionary has a ``greyscale`` key then\n    this must be true when mode is ``'L'`` or ``'LA'`` and\n    false when mode is ``'RGB'`` or ``'RGBA'``.\n    ";E='height';D='width';C=mode;A=info;A=dict(A);G=RegexModeDecode.match(C)
	if not G:raise Error("mode string should be 'RGB' or 'L;16' or similar.")
	C,B=G.groups()
	if B:B=int(B)
	if _D in A:
		if bool(A[_D])!=('L'in C):raise ProtocolError("info['greyscale'] should match mode.")
	A[_D]='L'in C;H='A'in C
	if _E in A:
		if bool(A[_E])!=H:raise ProtocolError("info['alpha'] should match mode.")
	A[_E]=H
	if B:
		if A.get(_B)and B!=A[_B]:raise ProtocolError('bitdepth (%d) should match bitdepth of info (%d).'%(B,A[_B]))
		A[_B]=B
	F,I=check_sizes(A.get('size'),A.get(D),A.get(E))
	if F:A[D]=F
	if I:A[E]=I
	if E not in A:
		try:A[E]=len(a)
		except TypeError:raise ProtocolError("len(a) does not work, supply info['height'] instead.")
	J=len(C)
	if _G in A:
		if A[_G]!=J:raise Error("info['planes'] should match mode.")
	a,K=itertools.tee(a);L=next(K);del K;M=L
	if D not in A:F=len(L)//J;A[D]=F
	if _B not in A:
		try:N=M.dtype
		except AttributeError:
			try:B=8*M.itemsize
			except AttributeError:B=8
		else:
			if N.kind=='b':B=1
			else:B=8*N.itemsize
		A[_B]=B
	for O in [D,E,_B,_D,_E]:assert O in A
	return Image(a,A)
fromarray=from_array
class Image:
	'A PNG image.  You can create an :class:`Image` object from\n    an array of pixels by calling :meth:`png.from_array`.  It can be\n    saved to disk with the :meth:`save` method.\n    '
	def __init__(A,rows,info):'\n        .. note ::\n\n          The constructor is not public.  Please do not call it.\n        ';A.rows=rows;A.info=info
	def save(A,file):
		'Save the image to the named *file*.\n\n        See `.write()` if you already have an open file object.\n\n        In general, you can only call this method once;\n        after it has been called the first time the PNG image is written,\n        the source data will have been streamed, and\n        cannot be streamed again.\n        ';B=Writer(**A.info)
		with open(file,'wb')as C:B.write(C,A.rows)
	def write(A,file):'Write the image to the open file object.\n\n        See `.save()` if you have a filename.\n\n        In general, you can only call this method once;\n        after it has been called the first time the PNG image is written,\n        the source data will have been streamed, and\n        cannot be streamed again.\n        ';B=Writer(**A.info);B.write(file,A.rows)
class Reader:
	'\n    Pure Python PNG decoder in pure Python.\n    '
	def __init__(B,_guess=_A,filename=_A,file=_A,bytes=_A):
		'\n        The constructor expects exactly one keyword argument.\n        If you supply a positional argument instead,\n        it will guess the input type.\n        Choose from the following keyword arguments:\n\n        filename\n          Name of input file (a PNG file).\n        file\n          A file-like object (object with a read() method).\n        bytes\n          ``bytes`` or ``bytearray`` with PNG data.\n\n        ';D=file;C=filename;A=_guess;E=(A is not _A)+(C is not _A)+(D is not _A)+(bytes is not _A)
		if E!=1:raise TypeError('Reader() takes exactly 1 argument')
		B.signature=_A;B.transparent=_A;B.atchunk=_A
		if A is not _A:
			if isarray(A):bytes=A
			elif isinstance(A,str):C=A
			elif hasattr(A,'read'):D=A
		if bytes is not _A:B.file=io.BytesIO(bytes)
		elif C is not _A:B.file=open(C,'rb')
		elif D is not _A:B.file=D
		else:raise ProtocolError('expecting filename, file or bytes array')
	def chunk(A,lenient=_C):
		"\n        Read the next PNG chunk from the input file;\n        returns a (*type*, *data*) tuple.\n        *type* is the chunk's type as a byte string\n        (all PNG chunk types are 4 bytes long).\n        *data* is the chunk's data content, as a byte string.\n\n        If the optional `lenient` argument evaluates to `True`,\n        checksum failures will raise warnings rather than exceptions.\n        ";A.validate_signature()
		if not A.atchunk:A.atchunk=A._chunk_len_type()
		if not A.atchunk:raise ChunkError('No more chunks.')
		C,type=A.atchunk;A.atchunk=_A;D=A.file.read(C)
		if len(D)!=C:raise ChunkError('Chunk %s too short for required %i octets.'%(type,C))
		E=A.file.read(4)
		if len(E)!=4:raise ChunkError('Chunk %s too short for checksum.'%type)
		B=zlib.crc32(type);B=zlib.crc32(D,B);B=struct.pack(_I,B)
		if E!=B:
			G,=struct.unpack(_I,E);H,=struct.unpack(_I,B);F='Checksum error in %s chunk: 0x%08X != 0x%08X.'%(type.decode('ascii'),G,H)
			if lenient:warnings.warn(F,RuntimeWarning)
			else:raise ChunkError(F)
		return type,D
	def chunks(B):
		'Return an iterator that will yield each chunk as a\n        (*chunktype*, *content*) pair.\n        '
		while _H:
			A,C=B.chunk();yield(A,C)
			if A==_L:break
	def undo_filter(E,filter_type,scanline,previous):
		'\n        Undo the filter for a scanline.\n        `scanline` is a sequence of bytes that\n        does not include the initial filter type byte.\n        `previous` is decoded previous scanline\n        (for straightlaced images this is the previous pixel row,\n        but for interlaced images, it is\n        the previous scanline in the reduced image,\n        which in general is not the previous pixel row in the final image).\n        When there is no previous scanline\n        (the first row of a straightlaced image,\n        or the first row in one of the passes in an interlaced image),\n        then this argument should be ``None``.\n\n        The scanline will have the effects of filtering removed;\n        the result will be returned as a fresh sequence of bytes.\n        ';C=previous;B=scanline;A=filter_type;D=B
		if A==0:return D
		if A not in(1,2,3,4):raise FormatError('Invalid PNG Filter Type.  See http://www.w3.org/TR/2003/REC-PNG-20031110/#9Filters .')
		F=max(1,E.psize)
		if not C:C=bytearray([0]*len(B))
		G=(_A,undo_filter_sub,undo_filter_up,undo_filter_average,undo_filter_paeth)[A];G(F,B,C,D);return D
	def _deinterlace(A,raw):
		'\n        Read raw pixel data, undo filters, deinterlace, and flatten.\n        Return a single array of values.\n        ';B=A.width*A.planes;J=B*A.height
		if A.bitdepth>8:D=array('H',[0]*J)
		else:D=bytearray([0]*J)
		C=0
		for O in adam7_generate(A.width,A.height):
			F=_A
			for (G,H,I) in O:
				K=int(math.ceil((A.width-G)/float(I)));L=int(math.ceil(A.psize*K));P=raw[C];C+=1;Q=raw[C:C+L];C+=L;F=A.undo_filter(P,Q,F);M=A._bytes_to_values(F,width=K)
				if I==1:assert G==0;E=H*B;D[E:E+B]=M
				else:
					E=H*B+G*A.planes;R=(H+1)*B;S=A.planes*I
					for N in range(A.planes):D[E+N:R:S]=M[N::A.planes]
		return D
	def _iter_bytes_to_values(A,byte_rows):
		'\n        Iterator that yields each scanline;\n        each scanline being a sequence of values.\n        `byte_rows` should be an iterator that yields\n        the bytes of each row in turn.\n        '
		for B in byte_rows:yield A._bytes_to_values(B)
	def _bytes_to_values(A,bs,width=_A):
		'Convert a packed row of bytes into a row of values.\n        Result will be a freshly allocated object,\n        not shared with the argument.\n        ';B=width
		if A.bitdepth==8:return bytearray(bs)
		if A.bitdepth==16:return array('H',struct.unpack(_K%(len(bs)//2),bs))
		assert A.bitdepth<8
		if B is _A:B=A.width
		D=8//A.bitdepth;C=bytearray();E=2**A.bitdepth-1;F=[A.bitdepth*B for B in reversed(list(range(D)))]
		for G in bs:C.extend([E&G>>A for A in F])
		return C[:B]
	def _iter_straight_packed(D,byte_blocks):
		'Iterator that undoes the effect of filtering;\n        yields each row as a sequence of packed bytes.\n        Assumes input is straightlaced.\n        `byte_blocks` should be an iterable that yields the raw bytes\n        in blocks of arbitrary size.\n        ';B=D.row_bytes;A=bytearray();C=_A
		for E in byte_blocks:
			A.extend(E)
			while len(A)>=B+1:F=A[0];G=A[1:B+1];del A[:B+1];C=D.undo_filter(F,G,C);yield C
		if len(A)!=0:raise FormatError('Wrong size for decompressed IDAT chunk.')
		assert len(A)==0
	def validate_signature(A):
		'\n        If signature (header) has not been read then read and\n        validate it; otherwise do nothing.\n        '
		if A.signature:return
		A.signature=A.file.read(8)
		if A.signature!=signature:raise FormatError('PNG file has invalid signature.')
	def preamble(A,lenient=_C):
		'\n        Extract the image metadata by reading\n        the initial part of the PNG file up to\n        the start of the ``IDAT`` chunk.\n        All the chunks that precede the ``IDAT`` chunk are\n        read and either processed for metadata or discarded.\n\n        If the optional `lenient` argument evaluates to `True`,\n        checksum failures will raise warnings rather than exceptions.\n        ';A.validate_signature()
		while _H:
			if not A.atchunk:
				A.atchunk=A._chunk_len_type()
				if A.atchunk is _A:raise FormatError('This PNG file has no IDAT chunks.')
			if A.atchunk[1]==_J:return
			A.process_chunk(lenient=lenient)
	def _chunk_len_type(C):
		"\n        Reads just enough of the input to\n        determine the next chunk's length and type;\n        return a (*length*, *type*) pair where *type* is a byte sequence.\n        If there are no more chunks, ``None`` is returned.\n        ";A=C.file.read(8)
		if not A:return _A
		if len(A)!=8:raise FormatError('End of file whilst reading chunk length and type.')
		B,type=struct.unpack('!I4s',A)
		if B>2**31-1:raise FormatError('Chunk %s is too large: %d.'%(type,B))
		D=set(bytearray(type))
		if not D<=set(range(65,91))|set(range(97,123)):raise FormatError('Chunk %r has invalid Chunk Type.'%list(type))
		return B,type
	def process_chunk(A,lenient=_C):
		'\n        Process the next chunk and its data.\n        This only processes the following chunk types:\n        ``IHDR``, ``PLTE``, ``bKGD``, ``tRNS``, ``gAMA``, ``sBIT``, ``pHYs``.\n        All other chunk types are ignored.\n\n        If the optional `lenient` argument evaluates to `True`,\n        checksum failures will raise warnings rather than exceptions.\n        ';type,C=A.chunk(lenient=lenient);D='_process_'+type.decode('ascii');B=getattr(A,D,_A)
		if B:B(C)
	def _process_IHDR(A,data):
		if len(data)!=13:raise FormatError('IHDR chunk has incorrect length.')
		A.width,A.height,A.bitdepth,A.color_type,A.compression,A.filter,A.interlace=struct.unpack('!2I5B',data);check_bitdepth_colortype(A.bitdepth,A.color_type)
		if A.compression!=0:raise FormatError('Unknown compression method %d'%A.compression)
		if A.filter!=0:raise FormatError('Unknown filter method %d, see http://www.w3.org/TR/2003/REC-PNG-20031110/#9Filters .'%A.filter)
		if A.interlace not in(0,1):raise FormatError('Unknown interlace method %d, see http://www.w3.org/TR/2003/REC-PNG-20031110/#8InterlaceMethods .'%A.interlace)
		B=bool(A.color_type&1);C=not A.color_type&2;D=bool(A.color_type&4);E=(3,1)[C or B];F=E+D;A.colormap=B;A.greyscale=C;A.alpha=D;A.color_planes=E;A.planes=F;A.psize=float(A.bitdepth)/float(8)*F
		if int(A.psize)==A.psize:A.psize=int(A.psize)
		A.row_bytes=int(math.ceil(A.width*A.psize));A.plte=_A;A.trns=_A;A.sbit=_A
	def _process_PLTE(B,data):
		A=data
		if B.plte:warnings.warn('Multiple PLTE chunks present.')
		B.plte=A
		if len(A)%3!=0:raise FormatError("PLTE chunk's length should be a multiple of 3.")
		if len(A)>2**B.bitdepth*3:raise FormatError('PLTE chunk is too long.')
		if len(A)==0:raise FormatError('Empty PLTE is not allowed.')
	def _process_bKGD(A,data):
		try:
			if A.colormap:
				if not A.plte:warnings.warn('PLTE chunk is required before bKGD chunk.')
				A.background=struct.unpack('B',data)
			else:A.background=struct.unpack(_K%A.color_planes,data)
		except struct.error:raise FormatError('bKGD chunk has incorrect length.')
	def _process_tRNS(A,data):
		B=data;A.trns=B
		if A.colormap:
			if not A.plte:warnings.warn('PLTE chunk is required before tRNS chunk.')
			elif len(B)>len(A.plte)/3:raise FormatError('tRNS chunk is too long.')
		else:
			if A.alpha:raise FormatError('tRNS chunk is not valid with colour type %d.'%A.color_type)
			try:A.transparent=struct.unpack(_K%A.color_planes,B)
			except struct.error:raise FormatError('tRNS chunk has incorrect length.')
	def _process_gAMA(A,data):
		try:A.gamma=struct.unpack('!L',data)[0]/100000.0
		except struct.error:raise FormatError('gAMA chunk has incorrect length.')
	def _process_sBIT(A,data):
		B=data;A.sbit=B
		if A.colormap and len(B)!=3 or not A.colormap and len(B)!=A.planes:raise FormatError('sBIT chunk has incorrect length.')
	def _process_pHYs(A,data):
		B=data;A.phys=B;C='!LLB'
		if len(B)!=struct.calcsize(C):raise FormatError('pHYs chunk has incorrect length.')
		A.x_pixels_per_unit,A.y_pixels_per_unit,D=struct.unpack(C,B);A.unit_is_meter=bool(D)
	def read(A,lenient=_C):
		'\n        Read the PNG file and decode it.\n        Returns (`width`, `height`, `rows`, `info`).\n\n        May use excessive memory.\n\n        `rows` is a sequence of rows;\n        each row is a sequence of values.\n\n        If the optional `lenient` argument evaluates to True,\n        checksum failures will raise warnings rather than exceptions.\n        ';D=lenient
		def H():
			'Iterator that yields all the ``IDAT`` chunks as strings.'
			while _H:
				type,B=A.chunk(lenient=D)
				if type==_L:break
				if type!=_J:continue
				if A.colormap and not A.plte:warnings.warn('PLTE chunk is required before IDAT chunk')
				yield B
		A.preamble(lenient=D);E=decompress(H())
		if A.interlace:
			def I():
				'Yield each row from an interlaced PNG.';F=bytearray(itertools.chain(*(E)));G=_F[A.bitdepth>8];B=A._deinterlace(F);C=A.width*A.planes
				for D in range(0,len(B),C):H=array(G,B[D:D+C]);yield H
			F=I()
		else:F=A._iter_bytes_to_values(A._iter_straight_packed(E))
		B=dict()
		for C in 'greyscale alpha planes bitdepth interlace'.split():B[C]=getattr(A,C)
		B['size']=A.width,A.height
		for C in 'gamma transparent background'.split():
			G=getattr(A,C,_A)
			if G is not _A:B[C]=G
		if getattr(A,'x_pixels_per_unit',_A):B['physical']=Resolution(A.x_pixels_per_unit,A.y_pixels_per_unit,A.unit_is_meter)
		if A.plte:B['palette']=A.palette()
		return A.width,A.height,F,B
	def read_flat(C):'\n        Read a PNG file and decode it into a single array of values.\n        Returns (*width*, *height*, *values*, *info*).\n\n        May use excessive memory.\n\n        `values` is a single array.\n\n        The :meth:`read` method is more stream-friendly than this,\n        because it returns a sequence of rows.\n        ';D,E,A,B=C.read();F=_F[B[_B]>8];A=array(F,itertools.chain(*(A)));return D,E,A,B
	def palette(A,alpha='natural'):
		"\n        Returns a palette that is a sequence of 3-tuples or 4-tuples,\n        synthesizing it from the ``PLTE`` and ``tRNS`` chunks.\n        These chunks should have already been processed (for example,\n        by calling the :meth:`preamble` method).\n        All the tuples are the same size:\n        3-tuples if there is no ``tRNS`` chunk,\n        4-tuples when there is a ``tRNS`` chunk.\n\n        Assumes that the image is colour type\n        3 and therefore a ``PLTE`` chunk is required.\n\n        If the `alpha` argument is ``'force'`` then an alpha channel is\n        always added, forcing the result to be a sequence of 4-tuples.\n        "
		if not A.plte:raise FormatError('Required PLTE chunk is missing in colour type 3 image.')
		B=group(array('B',A.plte),3)
		if A.trns or alpha=='force':C=array('B',A.trns or[]);C.extend([255]*(len(B)-len(C)));B=list(map(operator.add,B,group(C,1)))
		return B
	def asDirect(A):
		'\n        Returns the image data as a direct representation of\n        an ``x * y * planes`` array.\n        This removes the need for callers to deal with\n        palettes and transparency themselves.\n        Images with a palette (colour type 3) are converted to RGB or RGBA;\n        images with transparency (a ``tRNS`` chunk) are converted to\n        LA or RGBA as appropriate.\n        When returned in this format the pixel values represent\n        the colour value directly without needing to refer\n        to palettes or transparency information.\n\n        Like the :meth:`read` method this method returns a 4-tuple:\n\n        (*width*, *height*, *rows*, *info*)\n\n        This method normally returns pixel values with\n        the bit depth they have in the source image, but\n        when the source PNG has an ``sBIT`` chunk it is inspected and\n        can reduce the bit depth of the result pixels;\n        pixel values will be reduced according to the bit depth\n        specified in the ``sBIT`` chunk.\n        PNG nerds should note a single result bit depth is\n        used for all channels:\n        the maximum of the ones specified in the ``sBIT`` chunk.\n        An RGB565 image will be rescaled to 6-bit RGB666.\n\n        The *info* dictionary that is returned reflects\n        the `direct` format and not the original source image.\n        For example, an RGB source image with a ``tRNS`` chunk\n        to represent a transparent colour,\n        will start with ``planes=3`` and ``alpha=False`` for the\n        source image,\n        but the *info* dictionary returned by this method\n        will have ``planes=4`` and ``alpha=True`` because\n        an alpha channel is synthesized and added.\n\n        *rows* is a sequence of rows;\n        each row being a sequence of values\n        (like the :meth:`read` method).\n\n        All the other aspects of the image data are not changed.\n        ';A.preamble()
		if not A.colormap and not A.trns and not A.sbit:return A.read()
		F,G,C,B=A.read()
		if A.colormap:
			B['colormap']=_C;B[_E]=bool(A.trns);B[_B]=8;B[_G]=3+bool(A.trns);H=A.palette()
			def I(pixels):
				for A in pixels:A=[H[B]for B in A];yield array('B',itertools.chain(*(A)))
			C=I(C)
		elif A.trns:
			J=A.transparent;K=2**B[_B]-1;L=B[_G];B[_E]=_H;B[_G]+=1;M=_F[B[_B]>8]
			def N(pixels):
				for B in pixels:B=group(B,L);A=map(J.__ne__,B);A=map(K.__mul__,A);A=list(zip(A));yield array(M,itertools.chain(*map(operator.add,B,A)))
			C=N(C)
		D=_A
		if A.sbit:
			E=struct.unpack('%dB'%len(A.sbit),A.sbit);D=max(E)
			if D>B[_B]:raise Error('sBIT chunk %r exceeds bitdepth %d'%(E,A.bitdepth))
			if min(E)<=0:raise Error('sBIT chunk %r has a 0-entry'%E)
		if D:
			O=B[_B]-D;B[_B]=D
			def P(pixels):
				for A in pixels:yield[B>>O for B in A]
			C=P(C)
		return F,G,C,B
	def _as_rescale(J,get,targetbitdepth):
		'Helper used by :meth:`asRGB8` and :meth:`asRGBA8`.';B=targetbitdepth;C,D,E,A=get();F=2**A[_B]-1;G=2**B-1;H=float(G)/float(F);A[_B]=B
		def I():
			for A in E:yield[int(round(B*H))for B in A]
		if F==G:return C,D,E,A
		else:return C,D,I(),A
	def asRGB8(A):'\n        Return the image data as an RGB pixels with 8-bits per sample.\n        This is like the :meth:`asRGB` method except that\n        this method additionally rescales the values so that\n        they are all between 0 and 255 (8-bit).\n        In the case where the source image has a bit depth < 8\n        the transformation preserves all the information;\n        where the source image has bit depth > 8, then\n        rescaling to 8-bit values loses precision.\n        No dithering is performed.\n        Like :meth:`asRGB`,\n        an alpha channel in the source image will raise an exception.\n\n        This function returns a 4-tuple:\n        (*width*, *height*, *rows*, *info*).\n        *width*, *height*, *info* are as per the :meth:`read` method.\n\n        *rows* is the pixel data as a sequence of rows.\n        ';return A._as_rescale(A.asRGB,8)
	def asRGBA8(A):'\n        Return the image data as RGBA pixels with 8-bits per sample.\n        This method is similar to :meth:`asRGB8` and :meth:`asRGBA`:\n        The result pixels have an alpha channel, *and*\n        values are rescaled to the range 0 to 255.\n        The alpha channel is synthesized if necessary\n        (with a small speed penalty).\n        ';return A._as_rescale(A.asRGBA,8)
	def asRGB(F):
		"\n        Return image as RGB pixels.\n        RGB colour images are passed through unchanged;\n        greyscales are expanded into RGB triplets\n        (there is a small speed overhead for doing this).\n\n        An alpha channel in the source image will raise an exception.\n\n        The return values are as for the :meth:`read` method except that\n        the *info* reflect the returned pixels, not the source image.\n        In particular,\n        for this method ``info['greyscale']`` will be ``False``.\n        ";B,C,D,A=F.asDirect()
		if A[_E]:raise Error('will not convert image with alpha channel to RGB')
		if not A[_D]:return B,C,D,A
		A[_D]=_C;A[_G]=3
		if A[_B]>8:
			def E():return array('H',[0])
		else:
			def E():return bytearray([0])
		def G():
			for C in D:
				A=E()*3*B
				for F in range(3):A[F::3]=C
				yield A
		return B,C,G(),A
	def asRGBA(H):
		"\n        Return image as RGBA pixels.\n        Greyscales are expanded into RGB triplets;\n        an alpha channel is synthesized if necessary.\n        The return values are as for the :meth:`read` method except that\n        the *info* reflect the returned pixels, not the source image.\n        In particular, for this method\n        ``info['greyscale']`` will be ``False``, and\n        ``info['alpha']`` will be ``True``.\n        ";D,F,B,A=H.asDirect()
		if A[_E]and not A[_D]:return D,F,B,A
		I=_F[A[_B]>8];J=2**A[_B]-1;G=struct.pack('='+I,J)*4*D
		if A[_B]>8:
			def C():return array('H',G)
		else:
			def C():return bytearray(G)
		if A[_E]and A[_D]:
			def E():
				for D in B:A=C();convert_la_to_rgba(D,A);yield A
		elif A[_D]:
			def E():
				for D in B:A=C();convert_l_to_rgba(D,A);yield A
		else:
			assert not A[_E]and not A[_D]
			def E():
				for D in B:A=C();convert_rgb_to_rgba(D,A);yield A
		A[_E]=_H;A[_D]=_C;A[_G]=4;return D,F,E(),A
def decompress(data_blocks):
	'\n    `data_blocks` should be an iterable that\n    yields the compressed data (from the ``IDAT`` chunks).\n    This yields decompressed byte strings.\n    ';A=zlib.decompressobj()
	for B in data_blocks:yield bytearray(A.decompress(B))
	yield bytearray(A.flush())
def check_bitdepth_colortype(bitdepth,colortype):
	'\n    Check that `bitdepth` and `colortype` are both valid,\n    and specified in a valid combination.\n    Returns (None) if valid, raise an Exception if not valid.\n    ';B=colortype;A=bitdepth
	if A not in(1,2,4,8,16):raise FormatError('invalid bit depth %d'%A)
	if B not in(0,2,3,4,6):raise FormatError('invalid colour type %d'%B)
	if B&1 and A>8:raise FormatError('Indexed images (colour type %d) cannot have bitdepth > 8 (bit depth %d). See http://www.w3.org/TR/2003/REC-PNG-20031110/#table111 .'%(A,B))
	if A<8 and B not in(0,3):raise FormatError('Illegal combination of bit depth (%d) and colour type (%d). See http://www.w3.org/TR/2003/REC-PNG-20031110/#table111 .'%(A,B))
def is_natural(x):
	'A non-negative integer.'
	try:A=int(x)==x
	except (TypeError,ValueError):return _C
	return A and x>=0
def undo_filter_sub(filter_unit,scanline,previous,result):
	'Undo sub filter.';A=result;B=0
	for C in range(filter_unit,len(A)):D=scanline[C];E=A[B];A[C]=D+E&255;B+=1
def undo_filter_up(filter_unit,scanline,previous,result):
	'Undo up filter.';B=result
	for A in range(len(B)):C=scanline[A];D=previous[A];B[A]=C+D&255
def undo_filter_average(filter_unit,scanline,previous,result):
	'Undo up filter.';A=result;B=-filter_unit
	for C in range(len(A)):
		E=scanline[C]
		if B<0:D=0
		else:D=A[B]
		F=previous[C];A[C]=E+(D+F>>1)&255;B+=1
def undo_filter_paeth(filter_unit,scanline,previous,result):
	'Undo Paeth filter.';I=previous;D=result;A=-filter_unit
	for E in range(len(D)):
		M=scanline[E]
		if A<0:B=C=0
		else:B=D[A];C=I[A]
		F=I[E];G=B+F-C;J=abs(G-B);K=abs(G-F);L=abs(G-C)
		if J<=K and J<=L:H=B
		elif K<=L:H=F
		else:H=C
		D[E]=M+H&255;A+=1
def convert_la_to_rgba(row,result):
	A=result
	for B in range(3):A[B::4]=row[0::2]
	A[3::4]=row[1::2]
def convert_l_to_rgba(row,result):
	'\n    Convert a grayscale image to RGBA.\n    This method assumes the alpha channel in result is\n    already correctly initialized.\n    '
	for A in range(3):result[A::4]=row
def convert_rgb_to_rgba(row,result):
	'\n    Convert an RGB image to RGBA.\n    This method assumes the alpha channel in result is\n    already correctly initialized.\n    '
	for A in range(3):result[A::4]=row[A::3]
def binary_stdin():'\n    A sys.stdin that returns bytes.\n    ';return sys.stdin.buffer
def binary_stdout():
	'\n    A sys.stdout that accepts bytes.\n    ';A=sys.stdout.buffer
	if sys.platform=='win32':import msvcrt as B,os;B.setmode(sys.stdout.fileno(),os.O_BINARY)
	return A
def cli_open(path):
	if path=='-':return binary_stdin()
	return open(path,'rb')
def main(argv):'\n    Run command line PNG.\n    Which reports version.\n    ';print(__version__,__file__)
if __name__=='__main__':
	try:main(sys.argv)
	except Error as e:print(e,file=sys.stderr)