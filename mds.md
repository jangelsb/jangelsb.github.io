---
layout: app_page_gumroad
theme: gray
title: Magic Device Switch
description: Easily switch your magic devices between Macs automagically
gumroadlink: https://jangelsb.gumroad.com/l/liknbj
appiconpath: assets/images/source/mds/appicon.webp
---

{% include youtube.html id="fjPh_z38XdM" %}

## Idea

I have both a work and a personal MacBook Pro, and I want to use my Magic Keyboard and Magic Trackpad with both—just not at the same time.

**Magic Device Switch (MDS)** lets you easily "move" your Magic devices between Macs.

Unlike Universal Control, MDS works across Macs with different Apple IDs. It actually pairs and unpairs devices, acting as a true device switcher for Magic devices.


## Goal

Whenever I "dock" my MacBook at my desk, I want my Magic devices to connect automatically.


## How It Works

But first, let's define: 
- **Devices:** Any Magic Keyboard, Magic Trackpad, or Magic Mouse enabled in MDS.
- **Docking:** When your MacBook is connected to power, an external monitor, or wakes up while one of these conditions is active.

**The 'Docking' Process:**

When you "dock" your MacBook (e.g., MacBook A), and MDS sees that you have devices that are not currently connected, MDS will beging searching for:
   - Nearby Macs running MDS with paired devices.
   - Known devices in discovery mode.

If a nearby Mac (e.g., MacBook B) is found with paired devices,
- MDS will send an unpair command to MacBook B. This will cause those devices to be unpaired and enter discovery mode.
- Then MacBook A will attempt to pair to the list of devices that were unpaired from MacBook B

If devices are found in discovery mode,
- MDS will pair to them one by one until all devices are connected or the search times out.

> **Note:** In versions before 2.0, devices would unpair when a Mac went to sleep. Now, devices only unpair when MDS receives an unpair command over Bluetooth or when manually unpaired in the UI. This means you no longer need to worry about your devices being unpaired when undocking! 🎉


## Known Caveats

- If Magic devices are not connected to any computer for 2 minutes, they exit discovery mode and must be power-cycled to re-enter discovery mode.  
  _NOTE: This should rarely happen, since devices only unpair automatically when another Mac is actively trying to pair._


## Support
- [Change Log](./mds/releases)
- [Privacy Policy](https://jangelsb.github.io/mds/privacy)
- <a href="mailto:nextcalc.feedback@gmail@@com?subject=MDS Website"
   onmouseover="this.href=this.href.replace('@@','.')">
   Support Email
</a>