# Problem

- Client wanted a swap interface
- In the mood for over engineering this :)
- Reasonably complex & harder than you think
- Asked for this a lot working in defi
- Want to do a universal component
- How can I avoid writing the same thing in multiple view libs?

# Thoughts

- Challange is managing reactive state
- RxJS, MobX, Xstate - too heavy
- Testability is important
- Tanstack has great adaptors for Solid, Vue and React
  - Event emitters are not expressive
- Vue Composition API is good but getters are too magical

# Solution

- Use a custom "Signals" based approach
- Combine SolidJS API with Tanstack's Adaptors

# How it works

![Diagram](Signals.drawio.svg)

# Today Goals

- [x] `createSignal`
- [x] `createEffect`
- [x] `createMemo`
- [x] `createResource`
