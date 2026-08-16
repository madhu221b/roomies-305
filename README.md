# Roomies Radio

A full-screen girls' hostel music room: the supplied 29-song YouTube playlist, a tactile glass player, working seek/skip/shuffle controls, and a custom illustrated hostel backdrop.

## Run locally

```bash
npm install
npm run dev
```

Then open the local URL Vite prints.

## Notes

- The queue is generated from the public or unlisted YouTube/YouTube Music URL in `playlist.config.json`. `npm run dev` and `npm run build` automatically synchronize its current video IDs, order, titles, artists and thumbnails before starting. No song list is hardcoded in the application.
- A different playlist can also be tested at runtime without editing code by opening `/?playlist=<playlist URL or ID>`; the IFrame API reads that playlist directly.
- Click the queue in the top-right to choose any track.
- Click the physical wall switch to turn off the main ceiling light while leaving the room's smaller lights on. The preference persists across reloads.
- Keyboard controls: space to play/pause, left/right arrows to change tracks, `L` to toggle the room light, escape to close the queue.
- The background was generated specifically for this project; the source prompt is recorded below.

## Background prompt

Built-in image generation was used to create a bright, hand-painted editorial illustration of a lived-in Indian girls' hostel room at blue hour. It includes two clean-but-cluttered beds, wardrobes, laptops, coding screens, electronics tools, fairy lights, chai cups, an aloo-bhujia packet, a clear snack box of grapes, biscuits and nostalgic Indian fabrics, with calm central negative space for the interface. The art explicitly avoids people, prominent brands, an ominous dark mood, and an overly pink or childish look.

The ambient companion image was produced with the built-in image editor from the same artwork. The edit prompt changed lighting only: the central ceiling bulb is off, while the fairy lights, desk lamps, vanity bulbs, laptop screens and safe, cozy room visibility remain intact. Composition and objects were explicitly locked.
