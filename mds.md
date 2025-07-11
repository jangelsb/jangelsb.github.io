---
layout: app_page_gumroad
theme: gray
title: Magic Device Switch
description: Easily switch your magic devices between macs automagically
gumroadlink: https://jangelsb.gumroad.com/l/liknbj
appiconpath: assets/images/source/mds/appicon.webp
---

{% include youtube.html id="fjPh_z38XdM" %}

## Idea

I have a work MacBook Pro and a personal MacBook Pro. I have a Magic Keyboard and a Magic Trackpad that I want to use on both computers but at different times.

This app allows me to easily "move" my Magic devices between both computers.

Unlike Universal Control, this app will work on Macs with different Apple IDs. This is because it will actually pair the devices with the computer, so it acts like a device switcher for Magic devices.

## Goal

Whenever I "dock" my MacBook to my desk, I want to use the devices at my desk.


## How it works

First let's define 
**"devices"**
- any Magic device: Magic Keyboard, Magic Trackpad, Magic Mouse that is enabled in MDS

**"docking"**
- Whenever the computer is connected to power
- Or whenever an external montior is connect
- Or whenever the computer wakes up and one of the above options is active

When I "dock" my MackBook (let's say MacBook A), if there are devices that are not currently connected to the MacBook it will attempt to pair to the known devices

It does this by searching for nearby MacBooks with paired devices with MDS running OR known devices that are in discovery mode

If MDS finds a MacBook with paired devices (say MacBook B), it will send an unpair command to that device. Which will cause MacBook B to unpair from those devices, which will causes the devices to automatically go into discovery mode. Then MacBook A will attempt to pair to those devices.

If MDS finds devices in discovery mode, it will pair to those devices as they are found one by one until all devices are found or the searching timesout.


In previous versions (below 2.0) unpairing would happen when the MacBook went to sleep, but now there is no worries about sleep or "undocking" because devices are only unpaired when MDS recieves an 'unpair'
 command over Bluetooth OR manually unpaired in the UI


## Known Caveats

* If Magic devices are not connected to any computer for 2 minutes, they will exit discovery mode and will need to be power-cycled to reenter discovery mode.  
  _Note: This should rarely happen, since devices only unpair automatically when another Mac is actively trying to pair._


## Support
- [Change Log](./mds/releases)
- [Privacy Policy](https://jangelsb.github.io/mds/privacy)
- <a href="mailto:nextcalc.feedback@gmail@@com?subject=MDS Website"
   onmouseover="this.href=this.href.replace('@@','.')">
   Support Email
</a>