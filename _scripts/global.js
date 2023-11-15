<script type="text/javascript">
    // var server = "172.28.###.##";
    // var url = "http://" + server + ":102/videostream.cgi?user=username&pwd=password";

    // document.getElementById("home_icon").href = "https://jangelsb.github.io/";

    // <link rel="stylesheet" href="{{ '/assets/css/style.css?v=' | append: site.github.build_revision | relative_url }}">




        let link = document.createElement('link');

        link.rel = 'stylesheet';


        link.type = 'text/css';


        if ("{{page.theme}}" == "blue") {
            link.href = '/assets/css/style-blue.css';
        } else {
            link.href = '/assets/css/style.css';
        }

  
        document.getElementsByTagName('head')[0].appendChild(link);

</script>