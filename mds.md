---
layout: app_page_gumroad
theme: gray
title: Magic Device Switch
description: Easily switch your magic devices between Macs automagically
gumroadlink: https://jangelsb.gumroad.com/l/liknbj
appiconpath: assets/images/source/mds/appicon.webp
---

{% include youtube.html id="qW9lVXVLDR8" %}

## Idea

I want to easily "move" my Magic devices between Macs.

I have both a work and a personal MacBook Pro, and I want to use my Magic Keyboard and Magic Trackpad with both—just not at the same time.

Unlike Universal Control, Magic Device Switch (MDS) works across Macs with different Apple IDs. It actually pairs and unpairs devices, acting as a true device switcher for Magic devices.


## Goal

Whenever I "dock" my MacBook at my desk, I want my Magic devices to connect automatically.


## How It Works

**TL;DR**

Use your MacBooks as you normally would, when you "dock", press the spacebar a few times: BOOM 😎


**The 'Docking' Process:**

First, let's define "docking"
- **Docking:** When your MacBook is connected to power, an external monitor, or wakes up while one of these conditions is active.

When you "dock" your MacBook (e.g., MacBook A), and MDS sees that you have devices that are not currently connected, MDS will beging searching for:
   - Nearby Macs with connected devices
   - Or known devices in discovery mode

If a nearby Mac (e.g., MacBook B) is found with connected devices,
- MDS will send an unpair command to MacBook B. This will cause those devices to enter discovery mode.
- Then MacBook A will attempt to pair to the list of devices that were unpaired from MacBook B

If devices are found in discovery mode,
- MDS will pair to them one by one until all devices are connected or the search times out.


> **Note:** In versions before 2.0, devices would unpair when a Mac went to sleep. Now, devices only unpair when MDS receives an unpair command over Bluetooth or when manually unpaired in the UI. This means you no longer need to worry about your devices being unpaired when undocking! 🎉



**Pro Tips 💯** 
- When "docking" you Mac, press a button on one of your Magic devices (e.g., your spacebar) a few times. This will wake up your sleeping MacBook and MDS will then be able to find it (even if it is sleeping!!)
- Make sure to always have both MacBooks near each other when "docking"
- If anything ever goes wrong, power cycle your devices (without pressing any buttons on them) to have them enter discovery mode, and then "dock" your computer again (easiest solution is to open / close the MacBook lid)


**Known Caveats**
- If Magic devices are not connected to any computer for 2 minutes, they exit discovery mode and must be power-cycled to re-enter discovery mode.  

  _This should rarely happen, since devices only unpair automatically when another Mac is actively trying to pair._



## How To Set Up:
1. Install MDS on each Macbook that you want to switch devices between (up to 5 devices per license)
2. Then add the devices you want to move between computers to all instances of the app



## Trial & License
I have included a 30 day trial of the app for free! And if you want to use it for longer than that you can buy a license key that you can use on up to 5 different Macs!

Thank you so much for checking out my app. I hope you have a wonderful day and God bless!

## Support
- [Change Log](./mds/releases)
- [Privacy Policy](https://jangelsb.github.io/mds/privacy)
- <a href="mailto:nextcalc.feedback@gmail@@com?subject=MDS Website"
   onmouseover="this.href=this.href.replace('@@','.')">
   Support Email
</a>