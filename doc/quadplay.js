// quadplay✜ documentation theme

// Options set here are the *theme* defaults for anything a document did not set
// before loading this file.
//
// Everything with a name in the published style vocabulary [RMDc9j] is set
// here. What stays in quadplay.css is what the vocabulary cannot say: custom
// properties, pseudo-elements, media queries, and the classes the manual's own
// markup uses.
window.markdeepOptions = Object.assign({
    // Find the markdeep converter as a sibling of the theme.
    markdeepPath: document.currentScript.src.replace(/[^/]*$/, 'markdeep2.min.js'),

    stylesheet: 'quadplay.css',
    favicon:    '../console/icons/favicon-64x64.png',

    // The documentation is dark and only dark, so it forces the scheme and
    // offers the reader no control over it. Everything below states one arm of
    // a color because there is only one arm to state.
    initialColorScheme: 'dark',
    enableColorSchemeChoice: false,

    // The display face for the headings and the body face, both vendored beside
    // the theme. A theme stylesheet cannot declare them: @font-face there
    // resolves its src correctly, but the renderer needs the faces before it
    // emits anything that uses them, and its own stylesheet goes first
    // [RMDc4z]. `src` resolves against the theme's own directory.
    fontFaces: [{fontFamily: 'quadplay', src: '../console/Audiowide-Regular.ttf'},
                {fontFamily: 'Roboto',   src: 'Roboto-Light.ttf'}],

    main_nav:           {align: 'left'},
    definitionStyle:    'long',
    inlineCodeLang:     'PyxlScript',
    linkAPIDefinitions: true,

    style: {
        body: {
            fontFamily: 'Arial, Helvetica, sans-serif',
            fontSize: '16px',
            fontWeight: '400',
            lineHeight: '170%',
            textAlign: 'left',
            color: '#ccc',
            // A warmer grey than Markdeep's own dark page.
            backgroundColor: '#302b2b'
        },

        // h1 through h4 are set in the quadplay face; h5 and h6 stay in the
        // body face at the weight the group gives them.
        heading: {fontFamily: "Roboto, Arial, Helvetica, sans-serif",
                  fontWeight: '300',
                  // Markdeep's own dark heading color is white; these carry a
                  // shadow against the grey page, as the links do.
                  textShadow: '0px 1px 2px rgba(0,0,0,0.5)'},

        h1: {fontFamily: 'quadplay', fontSize: '40px',
             textAlign: 'center', marginBottom: '0'},

        // The rule above an H2 divides the manual into parts. The negative side
        // margins run it out to the edges of the column and the padding puts
        // the heading text back.
        h2: {fontFamily: 'quadplay', fontSize: '175%',
             marginBottom: '25px', marginLeft: '-20px', marginRight: '-20px',
             paddingLeft: '20px', paddingTop: '25px',
             borderBottomStyle: 'none',
             borderTopWidth: '6px', borderTopStyle: 'solid', borderTopColor: '#5a5a5a'},

        h3: {fontFamily: 'quadplay', fontSize: '150%', borderStyle: 'none'},
        h4: {fontFamily: 'quadplay', fontSize: '120%'},
        h5: {fontSize: '120%'},
        h6: {fontSize: '120%'},

        a: {color: '#80bfff', textShadow: '0px 1px 2px rgba(0,0,0,0.5)'},

        code:    {fontSize: '90%'},

        // Every listing is a panel, not only a tilde-fenced one: the manual is
        // mostly backtick fences and indented code. The colors come from the
        // variables quadplay.css sets, so the panel and the page move together.
        listing: {fontSize: '100%',
                  backgroundColor: 'var(--code-background)',
                  borderWidth: '1px', borderStyle: 'solid',
                  borderColor: 'var(--listing-line)',
                  boxShadow: '0px 1px 2px rgba(0,0,0,0.5)'},

        // The manual's tables are dense reference material, so they are set
        // smaller than the prose and lifted off the page.
        table: {fontSize: '16px', boxShadow: '0px 1px 2px rgba(0,0,0,0.5)'}
    }
}, window.markdeepOptions || {});

// Minimize browser flash while CSS loads
document.documentElement.style.backgroundColor = '#302b2b';

// Mandatory activation line. DO NOT MODIFY OR RELOCATE
((d)=>d.head.appendChild(((m)=>{m.dataset.theme=d.currentScript.src;return m;})(Object.assign(d.createElement('script'),{src:window.markdeepOptions.markdeepPath}))))(document);
