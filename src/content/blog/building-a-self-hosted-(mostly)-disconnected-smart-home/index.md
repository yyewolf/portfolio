---
title: "Building a Self-Hosted and (Mostly) Disconnected Smart Home"
description: "A detailed walkthrough of how I built a self-hosted smart home system that operates mostly disconnected from the internet, focusing on privacy and control."
date: "Dec 12 2025"
---

## Table of Contents

- [Introduction](#introduction)
- [The Infrastructure Behind It All](#the-infrastructure-behind-it-all)
- [Smart Lighting with Shelly Duo GU10](#smart-lighting-with-shelly-duo-gu10)
- [Multi-Room Audio with Snapcast and Music Assistant](#multi-room-audio-with-snapcast-and-music-assistant)
- [Reviving a Lenovo Smart Clock](#reviving-a-lenovo-smart-clock)
  - [Flashing Custom Firmware](#flashing-custom-firmware)
  - [A Custom Dashboard](#a-custom-dashboard)
- [Monitoring Electricity with Linky and TeleInfo](#monitoring-electricity-with-linky-and-teleinfo)
- [Environmental Monitoring with BME680](#environmental-monitoring-with-bme680)
- [Making Physical Switches Smart with Shelly 1L](#making-physical-switches-smart-with-shelly-1l)
- [Door Detection with an Ultrasonic Sensor](#door-detection-with-an-ultrasonic-sensor)
- [Security Camera in a Wall Charger](#security-camera-in-a-wall-charger)
- [Voice Control with Local Speech Recognition](#voice-control-with-local-speech-recognition)
- [The Total Cost](#the-total-cost)
- [Conclusion](#conclusion)

## Introduction

I've always been interested by Smart Home Technology, and even had previous (smaller) setups in the past. When I was still a student, I had a few Tuya light bulbs connected to Google Home, which was fun for a while but really became annoying once you had to move out, or had two places to handle or wanted to avoid relying on cloud services for basic functionalities. Not mentioning the privacy concerns that come with using cloud-connected devices and especially Tuya (being a Chinese company and having all the data going through their servers).

So I decided to build my own smart home system. One that runs locally, respects my privacy, and most importantly, keeps working even when the internet decides to take a day off. This post is a walkthrough of everything I set up, the hardware I chose, and the lessons I learned along the way.

Here's a sneak peek at my Home Assistant dashboard:

![Home Assistant Dashboard](/blog/building-a-self-hosted-(mostly)-disconnected-smart-home/screenshot_ha_dashboard.png)

## The Infrastructure Behind It All

Before diving into the actual smart home devices, I should mention that all of this runs on the infrastructure I detailed in my [previous blog post about building my infra on Infomaniak Kubernetes Managed](/blog/building-my-infra-on-infomaniak-kubernetes-managed). The short version is that Home Assistant and all related services run as pods managed through StatefulSets, bound to my local server at home. This infrastructure is still managed by Flux, so all the files are still available in my [GitHub repository](https://github.com/yyewolf/infra/tree/main/applications/software/home1/home-assistant).

Oh and, a few days before writing this post, my internet went down, and guess what, I could still control my light bulbs (at least from inside the network). That's pretty neat isn't it ?

## Smart Lighting with Shelly Duo GU10

The first devices I added were two [Shelly Duo GU10](https://www.shelly.com/fr/products/shelly-duo-gu10-white) bulbs, one for my living room and one for my bedroom. I originally chose Shelly because I thought you could easily flash them with Tasmota, only to realize that the new firmware they use is not compatible with a Tasmota OTA flash. Nevertheless, they still expose a local-only API that works perfectly with Home Assistant. I've set up the devices in ECO Mode, locked them down with a password, expose my Home Assistant with a NodePort service for the CoIoT protocol, and everything works great.

This is what a light switch looks like in Home Assistant:

![Shelly Light Switch in Home Assistant](/blog/building-a-self-hosted-(mostly)-disconnected-smart-home/screenshot_ha_light_switch.png)

Setting them up was straightforward. The Shelly integration in Home Assistant picks them up automatically, and from there you can control brightness and color temperature. There's a bit of configuration needed though, mainly adding a password to secure the devices. Unfortunately, the specific GU10 model I have doesn't support TLS, but if you're buying other Shelly products, I'd recommend enabling it on models that support it.

## Multi-Room Audio with Snapcast and Music Assistant

I wanted to be able to play music throughout my apartment, synced across multiple devices. For this I set up a [Snapcast](https://github.com/badaix/snapcast) server on my infrastructure along with [Music Assistant](https://music-assistant.io/) with Spotify integration.

Snapcast is pretty clever in how it works. The server receives an audio stream and broadcasts it to all connected clients, but the magic is in the synchronization. Each client reports its latency to the server, and the server adjusts the stream timing accordingly. This means whether you're listening on your computer, your phone, or a repurposed smart clock, the audio is perfectly in sync. No more walking between rooms and hearing that annoying echo effect you get with unsynchronized speakers.

Music Assistant sits on top of this and acts as the actual music player. It connects to various music sources (I use Spotify, but it supports many others) and outputs to Snapcast streams. The Home Assistant integration is really nice because you get a proper media player card with album art, playback controls, and queue management. You can also group and ungroup rooms on the fly, adjust individual room volumes, and even set different sources for different groups if you want.

The clients include my computer (running the Snapcast client in the background) and, as you'll see in the next section, a repurposed Lenovo Smart Clock that I gave a second life to.

## Reviving a Lenovo Smart Clock

I've owned a Lenovo Smart Clock for a while now, but it had been sitting in a drawer ever since I moved. The reason? I didn't want to connect it to Google Home. The privacy implications weren't great, and honestly the UX wasn't either. Every time you wanted to do something simple, it felt like fighting against Google's idea of what a smart clock should do.

This is what the clock looks like stock:

![Lenovo Smart Clock Stock](/blog/building-a-self-hosted-(mostly)-disconnected-smart-home/lenovo_smart_clock_stock.jpg)

Then I discovered that the signing keys for these devices had leaked, which meant custom firmware was now possible. This was the opportunity I was waiting for.

### Flashing Custom Firmware

The Lenovo Smart Clock runs on Android Things as its OS. The leaked keys allow you to sign custom boot images that the device will accept. I found a cursed tutorial that helped me, however this one particular tutorial helps to install LSC Awtrix :

File: https://blueforcer.de/awtrixhd/LSC_AWTRIX.zip

Instructions: https://pastebin.com/5hFstykr 

In case you wondered, as an "elektrichian" myself, here's a cursed USB cable that's gonna help you with the flashing process:

![Bootleg USB Cable](/blog/building-a-self-hosted-(mostly)-disconnected-smart-home/bootleg_usb_cable.png)

> **How to make the cursed cable:**
> 
> It's a USB 3.0 Type-A to USB 2.0 Type-A cable. Wire everything as normal, but leave the yellow and blue pair (USB 3.0 SuperSpeed lines) disconnected. When you connect the purple wire to VCC, it enables ADB mode on the clock. Yes, it's cursed. No, I don't make the rules.

![Bootleg USB Cable Schematic](/blog/building-a-self-hosted-(mostly)-disconnected-smart-home/bootleg_usb_cable_schema.png)

I followed this pretty much to the letter, however, I decided to go a different route. Instead of AwtrixHD (which is unfortunately locked behind a paywall for some features), I installed [WebviewKiosk](https://github.com/nktnet1/webview-kiosk). This essentially turns the clock into a dedicated web browser locked to a single URL. The app runs in full screen, hides the system UI, and auto-starts on boot. Perfect for a permanent dashboard.

### A Custom Dashboard

With WebviewKiosk running, I needed something to display. Existing dashboard solutions felt too heavy or didn't integrate well with Home Assistant, so I built my own: [web-smart-clock](https://github.com/yyewolf/web-smart-clock). It's available as a HACS addon and comes with a companion website.

The dashboard shows the time (obviously), current weather, and some quick status indicators. But the real magic is in the Home Assistant integration. Through the HACS addon, I can control the screen brightness based on time of day or ambient light, switch between different tabs (like showing a camera feed when someone rings the doorbell), force a browser refresh if something gets stuck, and more. All of this is exposed as services in Home Assistant, so you can trigger them from automations.

Under the hood, the dashboard maintains a persistent WebSocket connection to the server. This allows the server to push updates in real time and request actions from the client, like forcing a refresh if something goes wrong or checking that everything is still responsive. It's more reliable than polling and means the clock reacts instantly to changes.

I also set up persistent remote ADB access to the clock, just in case. If the dashboard ever gets completely stuck or I need to debug something at the system level, I can connect over the network and fix things without having to physically access the device. It's one of those "hope I never need it" safety nets.

It also runs a Snapcast client, so the clock's built-in speaker becomes part of my multi-room audio setup. The speaker isn't amazing, but it's good enough for background music or announcements. The volume is controlled through Home Assistant alongside all my other Snapcast clients.

Currently this is not a fully sync'ed client, meaning there might be slight delays compared to other clients. However, for casual listening and announcements, it works just fine. This is because the snapclient on the backend then transmit to the frontend through WebRTC which requires conversion to Opus.

In the future, I might add light controls directly to the dashboard. Being able to tap the screen to toggle lights or adjust brightness would be convenient, especially since the clock sits on my nightstand. For now though, voice control and the phone app work well enough.

And here's the custom dashboard in action:
![Lenovo Smart Clock Custom Dashboard](/blog/building-a-self-hosted-(mostly)-disconnected-smart-home/lenovo_smart_clock_custom.png)

## Monitoring Electricity with Linky and TeleInfo

In France, most (if not all) homes have a Linky smart meter installed by the electricity provider (Enedis). These meters are actually pretty neat from a technical standpoint. They expose real-time consumption data through a serial interface called TeleInfo, which uses a simple 1200 baud or 9600 baud serial protocol. The data includes current power draw, total consumption, pricing period (peak/off-peak), and more.

To tap into this, I got a [TeleInfo module from Tindie](https://www.tindie.com/products/hallard/wemos-teleinfo/). This module handles the signal conditioning needed to read the TeleInfo output, which uses an unusual modulation scheme that standard UART can't read directly. The module converts this into a clean 3.3V TTL signal that any microcontroller can handle.

I connected it to an ESP32 C3 MINI through UART. The whole thing is powered by USB, and luckily there's a socket right next to my meter. The wiring is straightforward: just three wires for ground, data, and power.

![Linky TeleInfo Setup](/blog/building-a-self-hosted-(mostly)-disconnected-smart-home/linky_teleinfo.webp)

I also 3D printed a case to keep everything tidy and protect the electronics from dust in the electrical cabinet. The ESP32 runs ESPHome with the [teleinfo component](https://esphome.io/components/sensor/teleinfo.html), which parses all the data fields and exposes them as sensors. In Home Assistant, I can see real-time power consumption, track my usage over time with the energy dashboard, and even set up alerts for unusual consumption patterns. It's satisfying to see exactly how much power each appliance uses when you turn it on.

## Environmental Monitoring with BME680

I wanted to keep an eye on the air quality in my apartment, so I hooked up a BME680 sensor to another ESP32 C3 MINI. The BME680 is a pretty capable little sensor from Bosch. It packs four different measurements into a single package: temperature, humidity, barometric pressure, and a gas resistance sensor that can detect VOCs (volatile organic compounds) for air quality monitoring.

![Temperature Monitor](/blog/building-a-self-hosted-(mostly)-disconnected-smart-home/temperature_monitor.webp)

The setup is pretty simple: the sensor connects to the ESP32 through I2C, which only needs four wires (power, ground, SDA, SCL). The ESP32 is flashed with ESPHome using the [BME680 component](https://esphome.io/components/sensor/bme680.html). ESPHome handles all the sensor communication and exposes the readings to Home Assistant.

The air quality measurement deserves a bit of explanation. The BME680 doesn't directly measure air quality in ppm or any standard unit. Instead, it measures the resistance of a heated metal oxide sensor, which changes in the presence of gases like alcohols, aldehydes, and other VOCs. ESPHome can calculate an IAQ (Indoor Air Quality) index from this, but it needs some calibration time to establish baseline readings for your specific environment. After a few days of running, the readings stabilize and become useful.

The sensor sits on top of my router, powered by USB. No fancy case for this one yet, it's just vibing there, doing its job. I've been meaning to 3D print an enclosure with proper ventilation holes, but the bare board works fine for now. The ESPHome integration in Home Assistant picks up all the sensor values automatically, and I've set up some basic automations to notify me if the air quality drops significantly or if the humidity gets too high.

## Making Physical Switches Smart with Shelly 1L

After a few days of living with smart bulbs, I ran into a problem. I kept accidentally hitting the physical light switch in my bedroom, which would cut power to the bulb entirely. Then I'd have to stumble through the dark room just to grab my phone and turn the light back on through the app. Not ideal.

The solution was a [Shelly 1L](https://www.shelly.com/fr/products/shelly-1l-gen3) relay. This little device sits behind your existing wall switch and keeps constant power to the bulb while still letting you use the physical switch. The "1L" stands for single live wire, meaning it doesn't require a neutral wire to operate. This is important in older European installations where the switch box often only has live and switched live, no neutral.

![Shelly 1L Before Installation](/blog/building-a-self-hosted-(mostly)-disconnected-smart-home/shelly_1l_before.webp)

The installation required some basic electrical work. You disconnect the existing switch from directly controlling the bulb, wire the Shelly 1L in between, and connect the switch to the Shelly's input terminal instead. Now the switch sends a signal to the Shelly rather than directly cutting power. The Shelly then decides what to do: toggle the relay, send a command to Home Assistant, or both.

The key feature for me was that the physical switch still works even when Home Assistant is down or there's no network. The Shelly 1L can be configured to toggle the light locally on button press, so you get the best of both worlds: app control when you want it, physical switch when you need it. This was a hard requirement for me. I didn't want to end up in a situation where my girlfriend couldn't turn on the lights because "the server is down."

Here's the automation that makes the button work in Home Assistant. When the Shelly detects a button press, it triggers this automation which actually controls the smart bulb (adjusting brightness and color temperature) rather than just toggling the relay:

![Bedroom Button Automation](/blog/building-a-self-hosted-(mostly)-disconnected-smart-home/screenshot_ha_bedroom_button.png)

I also have an automation that slowly turns on the bedroom light when I wake up. It gradually increases brightness over 15 minutes to simulate a sunrise, which is way more pleasant than a sudden bright light:

![Wake Up Light Automation](/blog/building-a-self-hosted-(mostly)-disconnected-smart-home/screenshot_ha_waking_up_turn_on_light.png)

Like the bulbs, you'll want to configure a password on the Shelly 1L to prevent anyone on your network from controlling it. Mine doesn't support TLS unfortunately, but newer Gen3 models should.

I have another Shelly 1L ready for the living room, but the wiring there is more complicated (multiple switches, different circuit layout) so I haven't installed it yet. Honestly, I don't use that switch anyway because of the next sensor I'm about to describe.

## Door Detection with an Ultrasonic Sensor

Instead of fumbling for a switch when I come home, I wanted the lights to turn on automatically. My solution was a bit unconventional: an HC-SR04 ultrasonic distance sensor pointed at my door frame.

![Ultrasonic Sensor Setup](/blog/building-a-self-hosted-(mostly)-disconnected-smart-home/ultrasonic_on_the_wall.webp)

The HC-SR04 works by sending out ultrasonic pulses and measuring how long it takes for them to bounce back. It's the same principle used in car parking sensors. The sensor can measure distances from about 2cm to 2 meters with reasonable accuracy. I mounted it on the wall next to my entrance, pointing at the door frame.

The sensor is connected to yet another ESP32 C3 MINI (I have a few of these lying around at this point), flashed with ESPHome. The wiring uses GPIO for the trigger and echo pins, plus power and ground. In ESPHome, I configured it to measure distance every 100ms, which is fast enough to catch a door opening. I then added a binary sensor that triggers when the distance reading changes by more than a threshold, indicating something (like a door or a person) has moved in front of the sensor.

The automation is straightforward: when the binary sensor triggers and it's after sunset, turn on the living room light. I added the sunset condition because I don't need lights during the day. To avoid false positives, the device on ESPHome has a filter that requires a delta of at least 25cm to consider it a valid trigger :

```yaml
sensor:
  - platform: ultrasonic
    trigger_pin: 17
    echo_pin: 16
    name: "Ultrasonic Sensor"
    update_interval: 200ms
    filters:
      - delta: 0.25   
```

![Door Open Automation](/blog/building-a-self-hosted-(mostly)-disconnected-smart-home/screenshot_ha_opened_door.png)

Why an ultrasonic sensor instead of a proper door contact sensor? Honestly, it was mostly because I had the parts lying around and wanted to experiment. A magnetic reed switch would be more reliable and use less power, but the ultrasonic approach has one advantage: it can detect when someone walks through the doorway even if they don't close the door behind them. It's also more fun to build.

No 3D printed case for this one either. It's just sitting on a USB charger plugged into the wall, doing its thing. The exposed electronics look a bit janky, but it's in a corner where nobody really notices it (I'm the only one haha).

![Ultrasonic Sensor Closeup](/blog/building-a-self-hosted-(mostly)-disconnected-smart-home/ultrasonic_on_the_wall.webp)

## Security Camera in a Wall Charger

I wanted a security camera with decent image quality, especially at night. After trying various ESP32-CAM setups and being disappointed with the low-light performance, I went a different route: a Raspberry Pi Zero 2 W with a proper camera module.

I scored the Pi Zero 2 W for 13€ off Leboncoin (basically French Craigslist), which was a nice find given how hard these can be to get at retail. For the camera, I got a [module with IR-cut from AliExpress](https://fr.aliexpress.com/item/1005006790000090.html) for about 15€. The IR-cut filter automatically switches between day and night mode, so you get proper colors during the day and infrared vision at night without that washed-out purple tint.

For the enclosure, I designed and 3D printed my own. It's pretty janky looking if I'm being honest, but it gets the job done. I might release the files at some point once I clean up the design a bit. To power it from mains, I used an [HLK-20M05](https://fr.aliexpress.com/item/1005002663857379.html) (about 5€), which provides enough current for the Pi.

![Camera 3D Print](/blog/building-a-self-hosted-(mostly)-disconnected-smart-home/cam_3d_print.webp)

I 3D printed a mount to hold the camera at the right angle inside the enclosure. The fit is tight but it works. Here's what it looks like mounted on the wall:

![Camera on Wall](/blog/building-a-self-hosted-(mostly)-disconnected-smart-home/cam_on_wall.png)

On the software side, I installed Raspbian Trixie on the Pi and set up [go2rtc](https://github.com/AlexxIT/go2rtc) with a custom systemd service to start on boot. go2rtc is great because it exposes the camera as an RTSP stream with minimal latency and low CPU usage.

The RTSP stream feeds into [Frigate](https://frigate.video/), which runs on my home server. Frigate handles motion detection, object recognition (it can tell the difference between a person and my shadow), and recording. It connects to Home Assistant through MQTT, so I get notifications, can view live streams, and access recordings all from my dashboard.

The difference in image quality compared to the ESP32-CAM is night and day (pun intended). Here's a daytime shot:

![Camera Angle Day](/blog/building-a-self-hosted-(mostly)-disconnected-smart-home/cam_angle.webp)

And here's what it looks like with the IR LEDs at night:

![Camera Angle Night](/blog/building-a-self-hosted-(mostly)-disconnected-smart-home/cam_angle_night.webp)

The infrared illumination is subtle enough that you don't notice it in a dark room, but it lights up the scene perfectly for the camera. Way better than the harsh white LED flash on the ESP32-CAM.

## Voice Control with Local Speech Recognition

The final piece of the puzzle was voice control. I wanted to be able to say "turn off the lights" without sending my voice to Google or Amazon's servers. For this, I set up a local speech processing pipeline using [faster-whisper](https://github.com/SYSTRAN/faster-whisper) for speech-to-text and [Piper](https://github.com/rhasspy/piper) for text-to-speech.

Faster-whisper is a reimplementation of OpenAI's Whisper model, optimized for speed using CTranslate2. It runs entirely locally and supports multiple languages. I'm using it with French language models since that's my native language. The recognition quality is impressive, it handles my accent and casual speech without issues, and the latency is low enough that it doesn't feel sluggish.

Piper handles the other direction: converting text responses back to speech. It's developed by the Rhasspy project and uses neural network based text-to-speech. The French voices sound natural enough that it doesn't feel like talking to a robot from the 90s. Both of these run as containers on my infrastructure.

Home Assistant's voice assistant integration ties everything together. You configure the speech-to-text and text-to-speech services, then set up a conversation agent to understand the intent behind what you're saying. This is where the "mostly disconnected" part comes in.

The one part that isn't local is the LLM for understanding intent and calling tools. For that, I use Infomaniak's GPT-OSS model through their AI API. Since Home Assistant's built-in OpenAI integration only works with OpenAI's API, I use [Extended OpenAI Conversation](https://github.com/jekalmin/extended_openai_conversation) which allows connecting to any OpenAI-compatible API endpoint. I currently have it pinned to version 1.0.6 because newer versions introduced some rate limiting issues that didn't play well with my setup.

I went with Infomaniak's GPT-OSS for a few reasons: it supports tool calling (which you need for Home Assistant to actually execute commands), it's hosted in Switzerland (good for privacy compared to US-based alternatives), and it's the cheapest option that meets my requirements. The model understands French well and can handle natural language commands like "allume la lumière du salon" or more complex requests like "éteins tout dans une heure."

Is it fully disconnected? No, the LLM part still needs internet. But the speech recognition and synthesis happen locally, which means your actual voice recordings never leave your network. The LLM only sees the transcribed text. It's a reasonable compromise between privacy and functionality, at least until local LLMs get good enough at tool calling to replace the cloud component.

## The Total Cost

One question people always ask about smart home setups is "how much did all this cost?" So here's a breakdown of everything:

| Item | Price |
|------|-------|
| Shelly Duo GU10 bulbs (x2) | 24.08€ |
| Shelly 1L relays (x2) | 40.68€ |
| Lenovo Smart Clock | Already owned |
| TeleInfo module | ~14€ ($15) |
| ESP32 C3 MINI (x3) | 6€ |
| BME680 sensor | 7.69€ |
| HC-SR04 ultrasonic sensor | Already owned |
| Raspberry Pi Zero 2 W | 13€ |
| Camera module with IR-cut | 15€ |
| HLK-20M05 power module | 5€ |
| 3D printing filament | ~4€ |
| **Total** | **~130€** |

Not bad for a full smart home setup with lighting, environmental monitoring, electricity tracking, a security camera, and multi-room audio. The Lenovo Smart Clock and ultrasonic sensor were things I already had lying around, so those didn't add to the cost.

The ESP32 C3 MINIs are ridiculously cheap at 2€ each, and they're the backbone of most of my sensors. If you're just starting out with home automation on a budget, I'd highly recommend picking up a few of these and some basic sensors to experiment with.

This doesn't include the home server (which I use for other things anyway) or the Infomaniak infrastructure costs (covered in my other blog post). But for the actual smart home hardware, under 140€ is pretty reasonable.

## Conclusion

Building a self-hosted smart home has been a fun project that taught me a lot about embedded systems, home automation, and the importance of local-first design. It took some time and effort to get everything working, but now I have a system that:

- Works without an internet connection for all the essential stuff (lights, switches, sensors)
- Doesn't send my data to random cloud services
- Gives me full control over every component, from the firmware to the automations
- Actually survived a real internet outage without breaking
- Lets me tinker and expand without being locked into any vendor's ecosystem

The whole thing runs on my Kubernetes cluster, which means I get all the benefits of proper orchestration, monitoring, and backups. If something breaks, I can roll back. If I want to add a new service, I just write a manifest and push it. It's probably overkill for a single apartment, but it's the same infrastructure I use for other projects, so it made sense to leverage it. If you're interested in that side of things, check out my [infrastructure blog post](/blog/building-my-infra-on-infomaniak-kubernetes-managed).

Looking back, the investment in local-first hardware (Shelly, ESPHome devices) has paid off. These devices work independently of any cloud service and communicate directly with Home Assistant over the local network. Even if Shelly as a company disappeared tomorrow, my bulbs and relays would keep working.

And yes, my router is starting to question my life choices:

![WiFi Devices](/blog/building-a-self-hosted-(mostly)-disconnected-smart-home/wifi.png)

(FYI, I replaced the ESP Cam with the Raspberry Pi camera, hence the unexpected device in the screenshot.)

What's next? I still need to install that second Shelly 1L in the living room, print some proper cases for the exposed ESP32 boards, and upgrade the camera module for better night vision. I'm also thinking about adding some presence detection using Bluetooth or mmWave sensors, and maybe a proper doorbell integration. The beauty of a self-hosted system is that you can always add more.

Is it overkill for a small apartment? Probably. Was it worth it? Absolutely.
