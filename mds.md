---
layout: app_page_gumroad
theme: gray
title: Magic Device Switch
description: Easily switch your magic devices between macs automagically
gumroadlink: https://jangelsb.gumroad.com/l/liknbj
appiconpath: assets/images/source/mds/appicon.png
---

{% include youtube.html id="fjPh_z38XdM" %}


## Idea

I have a work MacBook Pro and a personal MacBook Pro. I have a Magic Keyboard and a Magic Trackpad that I want to use on both comptuers but at different times.

This app allows me to easily move my Magic devices betwen both comptuers.

Unlike Universal Control, this app will work on macs with different Apple Ids. It will actually pair the devices with the computer, so it acts like a device switcher for magic devcies.


## Goal
When the app thinks you are docking your MacBook to your desk - use the desk periphals.

When the app thinks you are undocking your MacBook from your desk - unpair and don't use the desk periphals. 


## How it works

It will try to pair to the devices you specify:
- When the computer wakes up and is connected to power
- Or if the computer ever starts to use a monitor that is not the built in display

It will unpair the devices
- When the computer goes to sleep and is not connected to power


## Known Caveats 
* If Magic Devices are not connected to a computer for 2 minutes, they will exit pairing mode and will need to be power cycled.


## Support
- [Change Log](./mds/releases)
- [Privacy Policy](https://jangelsb.github.io/mds/privacy)
- <a href="mailto:nextcalc.feedback@gmail@@com?subject=MDS Website"
   onmouseover="this.href=this.href.replace('@@','.')">
   Support Email
</a>