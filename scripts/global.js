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

            var baseCSSId = 'base_css'; 
            if (!document.getElementById(baseCSSId))
            {
                var head  = document.getElementsByTagName('head')[0];
                var link  = document.createElement('link');
                link.id   = baseCSSId;
                link.rel  = 'stylesheet';
                link.type = 'text/css';
                link.media = 'all';

                link.href = '/assets/css/base.css';

                head.appendChild(link);
            }

            var themeCSSId = 'custom_css'; 
            if (!document.getElementById(themeCSSId))
            {
                var head  = document.getElementsByTagName('head')[0];
                var link  = document.createElement('link');
                link.id   = themeCSSId;
                link.rel  = 'stylesheet';
                link.type = 'text/css';
                link.media = 'all';

                switch (_dargs["theme"]) {
                    case "orange":
                        link.href = '/assets/css/style-orange.css';
                        break;
                    case "gray":
                        link.href = '/assets/css/style-gray.css';
                        break;
                    default:
                        link.href = '/assets/css/style-default.css';

                }

                head.appendChild(link);
            }

        },
        helloWorld : function() {
            // do something async later - example: http://plnkr.co/edit/iE0Vr7sszfqrrDIsR8Wi?p=preview
        }
    };
}());