---
---
//rest of your JavaScript - ref https://stackoverflow.com/a/39853997/9605061
// frontmatter docs: https://jekyllrb.com/docs/front-matter/


// var server = "172.28.###.##";
// var url = "http://" + server + ":102/videostream.cgi?user=username&pwd=password";

// document.getElementById("home_icon").href = "https://jangelsb.github.io/";

// <link rel="stylesheet" href="{{ '/assets/css/style.css?v=' | append: site.github.build_revision | relative_url }}">



// ref: https://stackoverflow.com/a/2190927/9605061
var MYLIBRARY = MYLIBRARY || (function(){
    var _dargs = {}; // private

    return {
        init : function(Args) {
            _dargs = Args;
            // some other initialising
        },
        helloWorld : function() {
            
            var cssId = 'custom_css';  // you could encode the css path itself to generate id..
            if (!document.getElementById(cssId))
            {
                var head  = document.getElementsByTagName('head')[0];
                var link  = document.createElement('link');
                link.id   = cssId;
                link.rel  = 'stylesheet';
                link.type = 'text/css';
                link.media = 'all';

                switch (_dargs["theme"]) {
                    case "blue":
                        link.href = '/assets/css/style-blue.css';
                        break;
                    default:
                        link.href = '/assets/css/style.css';

                }

                head.appendChild(link);
            }
        }
    };
}());