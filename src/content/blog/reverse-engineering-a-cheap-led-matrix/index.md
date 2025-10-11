---
title: "Reverse Engineering a Cheap LED Matrix"
description: "A quick peek into my process of reverse engineering a low-cost LED matrix display to display basically anything from basically anything."
date: "Oct 11 2025"
---

## Table of Contents

- [Preface](#preface)
- [The Product](#the-product)
- [Reverse Engineering](#reverse-engineering)
  - [Initial Traffic Analysis](#initial-traffic-analysis)
  - [Decompiling the Android App](#decompiling-the-android-app)
  - [Understanding the Protocol](#understanding-the-protocol)
- [Building the Go Library](#building-the-go-library)
- [Implementation Details](#implementation-details)
- [Results and Demo](#results-and-demo)
- [Conclusion](#conclusion)

## Preface


I recently received a message from my dad showing off a cheap LED matrix display he had found in a store (Action). He also told me that it worked through an Android App and that really got me curious instantly.

![alt text](/blog/reverse-engineering-a-cheap-led-matrix/8F251EC3.png)

After some quick research, I found that they sold two models, one with a 32x32 matrix and one with a 16x64 matrix. Sold at 15€ and 20€ respectively. Both models are advertised as being able to display text messages, time, weather and even some animations.

The following one is a model that looks exactly the same, where the app also looks to be the same, found on Aliexpress for 30€ (without shipping) :

![alt text](/blog/reverse-engineering-a-cheap-led-matrix/DE0B4C2F.png)

Sooo, my first question was of course, what can I do with this? Can I display custom messages? Can I display images? Can I control it from my computer? 

I then popped open Jadx and started looking at that app. I stumbled upon a class called `ConnectType` which seemed to be a class that held the connection type constants. 

![alt text](/blog/reverse-engineering-a-cheap-led-matrix/AB249F98.png)

This told me that the app supported multiple connection types, including Bluetooth and WiFi, BLE is often pretty easy to use and I already had a dongle ready, so I hopped in my car and decided to go buy one.

## The Product

The product comes in a small box, with the display itself, a power adapter and a small manual. The display has a USB C port for power. Through the phone using the `iPixel Color` app, I was able to connect to the display through Bluetooth and send it some text messages and change the color.

The features are nothing fancy, you can display text messages with some basic animations, you can display the time and date, you can display pictures from your phone and you can display some pre-made animations.

## Reverse Engineering

### Initial Traffic Analysis

My first thought going into this was trying to sniff the Bluetooth traffic between the app and the display. For this I simply used my phone, enabled developer options and enabled Bluetooth HCI snoop log. This creates a file called `btsnoop_hci.log` in the root of your internal storage.

Then I used the app to connect to the display and sent it a few messages, changed some colors and displayed a few images. After this I copied the log file to my computer and opened it in Wireshark.

![alt text](/blog/reverse-engineering-a-cheap-led-matrix/FC28D7EF.png)

This showed me things, but clearly I wasn't able to make much sense of it. To understand more about it using this technique, I would need to be able to snoop the traffic as it was being sent, which I couldn't do with what I had.

### Decompiling the Android App

So I decided to try and look more into the app itself. I stumbled my way to a class called `SendCore` which seemed to be the class that handled sending data to the display.

![alt text](/blog/reverse-engineering-a-cheap-led-matrix/6DDF1996.png)

This class describes how to build the packets, and how to send them. It also describes the different commands that can be sent to the display.

Digging deeper into the decompiled code, I found several key components:

1. **Packet Structure**: Data can be sent in chunks with specific headers and checksums
2. **Image Processing**: Images are converted to RGB byte arrays before transmission
3. **Command Types**: Different data types (text, images, animations) use different command codes, I'm only interested in images cuz if you have an image then you can do basically anything

### Understanding the Protocol

After analyzing the code more thoroughly, I was able to piece together the communication protocol:

1. **Connection**: Standard BLE connection using specific service and characteristic UUIDs
2. **Device Info**: Query device capabilities and screen dimensions
3. **Data Transmission**: Images sent in 12KB chunks with CRC32 verification
4. **Commands**: Simple byte arrays for controlling LED state and switching modes

The packet structure follows this pattern:
- Header bytes indicating data type
- Chunk information (index, total chunks)
- CRC32 checksum (for certain data types)
- Payload data

## Building the Go Library

With a good understanding of the protocol, I decided to implement my own library in Go. Why Go? Cuz reasons.

The main challenges were:

1. **BLE Communication**: Used TinyGo's bluetooth package for cross-platform BLE support
2. **Chunked Transmission**: Implementing the same chunking protocol as the Android app
3. **Error Handling**: Making sure the library is robust and provides good error messages

Here's the basic structure I ended up with:

```go
type Display interface {
    Connect(ctx context.Context) error
    Disconnect() error
    GetScreenSize(ctx context.Context) (width, height int, err error)
    GetDeviceInfo(ctx context.Context) (*DeviceInfo, error)
    SendImage(ctx context.Context, image image.Image) error
    SwitchToDiyFunMode(mode int) error
}
```

## Implementation Details

The trickiest part was getting the image transmission right. The display expects RGB data in a very specific format:

1. Images must be resized to match the display dimensions (32x32 or 16x64)
2. Color data needs to be in RGB format (not RGBA)

I also had to reverse engineer the device info query protocol. The display responds with useful information like:

- Device type and capabilities
- MCU firmware version
- WiFi/BLE module version  
- LED matrix dimensions
- Whether password protection is enabled

```go
type DeviceInfo struct {
    DeviceType   byte
    MCUVersion   string
    WiFiVersion  string  
    Width        int
    Height       int
    HasWifi      bool
    PasswordFlag byte
}
```

## Demonstration

I also own another BLE device, a heart rate monitor from i forgot where. I also included in the library a small demo program that can connect to both a display and a heart rate monitor, and print out the heart rate data to display live !

<video src="/blog/reverse-engineering-a-cheap-led-matrix/demo.mp4" width="550px" controls></video>

## Results 

The end result is a [fully functional Go library](https://github.com/yyewolf/go-ipxl) that can:

- Connect to iPixel LED displays via Bluetooth
- Query device information and capabilities
- Send custom images from any Go program
- Control LED states and display modes
- Handle errors gracefully with proper timeouts

Here's a simple example of using the library:

```go
// Connect to display
display := ipxl.NewDisplay("AA:BB:CC:DD:EE:FF")
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()

if err := display.Connect(ctx); err != nil {
    log.Fatal("Failed to connect:", err)
}

// Load and display an image
processor := ipxl.NewBitmapProcessor(32, 32)
img, _ := processor.LoadImageFromFile("cool-image.png")
display.SendImage(ctx, img)
```

The library automatically handles:
- BLE connection management
- Image resizing and color conversion
- Chunked data transmission with verification
- Device capability detection

## Conclusion

This project was a fantastic deep dive into reverse engineering consumer electronics. What started as curiosity about a €15 LED matrix turned into a somewhat partial understanding (as of now) of its communication protocol and a fully functional Go library.

Key takeaways from this project:

1. **Android app decompilation** is often more revealing than traffic sniffing for understanding protocols
2. **BLE communication** is surprisingly accessible once you understand the basics
3. **Reverse engineering** consumer electronics can be very rewarding and educational
4. **Building libraries** from reverse engineered protocols helps others use these devices in creative ways

The complete source code for the Go library is available on GitHub, and I've made sure to document everything thoroughly so others can either use it directly or learn from the implementation.

Whether you want to display custom animations, build a smart home status display, or just have fun with a LED matrix, this library makes it possible to control these devices from any platform that runs Go and supports BLE.

Now excuse me while I figure out how to display real-time system metrics on my new favorite desk accessory! 🚀 
