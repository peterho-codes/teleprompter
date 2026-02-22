# Textream Web

A browser-based teleprompter that highlights your script in real time as you speak. Inspired by [Textream for macOS](https://github.com/f/textream) by Fatih Kadir Akin.

![Demo](docs/demo.gif)

## Features

- **Real-time word highlighting** — words light up as you say them using on-device speech recognition
- **Tap to jump** — click any word to move the tracker to that position
- **Pause & resume** — go off-script and pick up where you left off
- **Live waveform** — visual mic activity indicator
- **Language selection** — English, Bahasa Malaysia, Chinese, Spanish, French, German, and more
- **Adjustable font size** — scale text to fit your setup
- **No account required** — open and use immediately

## Browser Support

> **Requires Chrome or Edge.** The Web Speech API used for real-time recognition is not supported in Firefox or Safari.

| Browser | Supported |
|---|---|
| Chrome | ✅ |
| Edge | ✅ |
| Firefox | ❌ |
| Safari | ❌ (partial) |

## Getting Started

### Use online

Visit the live deployment at: `https://your-deployment.vercel.app`

### Run locally

```bash
git clone https://github.com/YOUR_USERNAME/textream-web.git
cd textream-web
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in Chrome or Edge.

### Microphone permission

The first time you click **▶ Present**, your browser will ask for microphone access. Click **Allow**. If you accidentally blocked it:

- **Chrome/Edge**: click the mic icon in the address bar → Allow → refresh
- Or go to `chrome://settings/content/microphone` and remove `localhost` / your domain from the blocked list

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/textream-web)

Or manually:

```bash
npm install -g vercel
vercel deploy
```

## Project Structure

```
textream-web/
├── app/
│   ├── layout.tsx              # Root layout
│   └── page.tsx                # Main teleprompter UI
├── components/
│   └── Waveform.tsx            # Web Audio API waveform visualizer
├── hooks/
│   ├── useSpeechRecognition.ts # Web Speech API wrapper (start/stop/pause/resume)
│   └── useScriptTracker.ts     # Word tokenizer + Levenshtein cursor engine
└── package.json
```

## How the Word Tracking Works

The cursor advancement uses a sliding window algorithm:

1. The last 3 spoken words are used as an anchor
2. The anchor is compared against a ±12-word window around the current position
3. Each candidate position is scored using Levenshtein similarity
4. The cursor advances only if confidence exceeds 55%, preventing misfires from filler words or misrecognitions

To tune for your use case, adjust `LOOKAHEAD` and the similarity threshold in `hooks/useScriptTracker.ts`.

## Privacy

All speech processing happens in your browser via the Web Speech API. On Chrome, audio is sent to Google's speech recognition servers — no data is sent to or stored by this application.

## Credits

- Original macOS app concept: [Textream by Fatih Kadir Akin](https://github.com/f/textream)
- Original idea: [Semih Kışlar](https://x.com/semihdev)

## License

MIT
