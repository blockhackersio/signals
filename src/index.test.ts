import { expect, test, vi } from "vitest";

type Signal<T> = [get: Accessor<T>, set: Setter<T>];
type Accessor<T> = () => T;
type Setter<T> = (v: T | Updater<T>) => T;
type Updater<T> = (prev?: T) => T;
type Effect = () => void;
type Target<T> = { value: T };
type EffectMap = Map<Target<any>, Set<Effect>>;
type ResourceReturn<T> = [
  {
    (): T | undefined;
    state: "unresolved" | "pending" | "ready" | "errored";
    loading: boolean;
    error: any;
    latest: T | undefined;
  },
  {
    mutate: (v: T | undefined) => T | undefined;
    refetch: () => Promise<T | None>;
  },
];
type ResourceSignal<T> = ResourceReturn<T>[0];

type Optional<T> = T | None;
type None = undefined;
const None = undefined;

function isUpdater<T>(v: T | Updater<T>): v is Updater<T> {
  return typeof v === "function";
}

const effects: EffectMap = new Map();
let currentEffect: Optional<Effect> = None;

function track<T>(target: Target<T>) {
  if (currentEffect) {
    const listeners = effects.get(target) ?? new Set<Effect>();
    listeners.add(currentEffect);
    if (!effects.has(target)) effects.set(target, listeners);
  }
}

function trigger<T>(target: Target<T>) {
  const listeners = effects.get(target);
  if (listeners) {
    for (const listener of listeners) {
      listener();
    }
  }
}

function createSignal<T>(initialValue: T): Signal<T> {
  const target: Target<T> = { value: initialValue };

  const get: Accessor<T> = () => {
    track(target);
    return target.value;
  };

  const set: Setter<T> = (v) => {
    const updater = isUpdater(v) ? v : () => v;
    target.value = updater(target.value);
    trigger(target);
    return target.value;
  };

  return [get, set];
}

function createEffect<T>(fn: () => T): void;
function createEffect<T>(fn: (v: T) => T, value: T): void;
function createEffect<T>(fn: (v?: T) => T, value?: T): void {
  currentEffect = () => {
    value = fn(value);
  };
  currentEffect();
  currentEffect = None;
}

function createMemo<T>(fn: () => T): Accessor<T>;
function createMemo<T>(fn: (v: T) => T, value: T): Accessor<T>;
function createMemo<T>(fn: (v?: T) => T, value?: T): Accessor<T> {
  const [out, setOut] = createSignal<Optional<T>>(value);
  createEffect((v) => {
    const o = fn(v);
    setOut(o);
    return o;
  }, value);
  return out as Accessor<T>;
}

type Fetcher<T, U> = (v?: U) => Promise<T>;

function createResource<T, U>(fetcher: Fetcher<T, U>): ResourceReturn<T>;
function createResource<T, U>(
  source: Accessor<U>,
  fetcher: Fetcher<T, U>,
): ResourceReturn<T>;
function createResource<T, U>(
  arg1: Fetcher<T, U> | Accessor<U>,
  arg2?: Fetcher<T, U>,
): ResourceReturn<T> {
  // Parse arguments
  const [source, fetcher] =
    arguments.length === 1
      ? [None, arg1 as Fetcher<T, U>]
      : [arg1 as Accessor<U>, arg2 as Fetcher<T, U>];
  // console.log(source, fetcher);
  const [out, setOut] = createSignal<Optional<T>>(None);
  const signal = out as ResourceSignal<T>;
  signal.state = "unresolved";

  async function refetch(v?: U) {
    const prom = fetcher(v);
    signal.state = "pending";
    signal.loading = true;
    try {
      const res = await prom;
      setOut(res);
      signal.latest = res;
      signal.state = "ready";
      return res;
    } catch (err) {
      signal.state = "errored";
    } finally {
      signal.loading = false;
    }
  }

  function mutate(v: T | undefined): T | undefined {
    setOut(v);
    signal.latest = v;
    return v;
  }

  nextTick(() => {
    createEffect(() => {
      if (source) {
        refetch(source());
      } else refetch();
    });
  });

  return [out as ResourceSignal<T>, { refetch, mutate }];
}

test("createSignal with initial value", () => {
  const [get] = createSignal(0);
  expect(get()).toBe(0);
});

test("createSignal and change with set", () => {
  const [get, set] = createSignal(0);
  set(3.1415);
  expect(get()).toBe(3.1415);
});

test("createSignal and change with updater", () => {
  const [get, set] = createSignal(0);
  set((v = 0) => v + 1);
  expect(get()).toBe(1);
  set((v = 0) => v + 1);
  expect(get()).toBe(2);
});

test("createSignal with effect", () => {
  const [get, set] = createSignal(0);
  let external = get();
  createEffect(() => {
    external = get();
  });
  set(1);
  expect(external).toBe(1);
  set(2);
  expect(external).toBe(2);
});

test("Signal accessed multiple times within effect", () => {
  const [get, set] = createSignal(0);
  const fn = vi.fn(() => {
    get();
    get();
  });
  createEffect(fn);
  expect(fn).toHaveBeenCalledTimes(1);
  set(1);
  expect(fn).toHaveBeenCalledTimes(2);
  set(2);
  expect(fn).toHaveBeenCalledTimes(3);
});

test("createEffect can be passed an accumulator", () => {
  const [get, set] = createSignal(0);

  let externalSum = 0;

  createEffect((acc) => {
    const total = acc + get();
    externalSum = total;
    return total;
  }, 0);

  set(1);
  expect(externalSum).toBe(1);
  set(2);
  expect(externalSum).toBe(3);
});

test("createMemo", () => {
  const [a, setA] = createSignal(10);
  const [b, setB] = createSignal(10);

  const product = createMemo(() => a() * b());

  expect(product()).toBe(100);
  setA(5);
  expect(product()).toBe(50);
  setB(5);
  expect(product()).toBe(25);
});

test("createResource happy", async () => {
  const { promise, resolve } = createDeferred();

  const [value, { mutate }] = createResource(promise);
  expect(value.state).toBe("unresolved");
  await nextTick();
  expect(value.loading).toBe(true);
  expect(value.state).toBe("pending");
  resolve("Foo");
  await nextTick();
  expect(value.state).toBe("ready");
  expect(value()).toBe("Foo");
  expect(value.latest).toBe("Foo");
  expect(value.error).toBe(None);
  expect(value.loading).toBe(false);
  expect(promise).toHaveBeenCalledOnce();
  mutate("Bar");
  expect(value()).toBe("Bar");
  expect(value.latest).toBe("Bar");
  expect(promise).toHaveBeenCalledOnce();
});

test("createResource error", async () => {
  const { promise, reject } = createDeferred();
  const [value] = createResource(promise);
  expect(value.state).toBe("unresolved");
  await nextTick();
  expect(value.loading).toBe(true);
  expect(value.state).toBe("pending");
  reject("Whoops!");
  await nextTick();
  expect(value.state).toBe("errored");
  expect(value()).toBe(None);
  expect(value.latest).toBe(None);
  expect(value.loading).toBe(false);
});

test("createResource with signal", async () => {
  const { promise, resolve, reset } = createDeferred();
  const [signal, setSignal] = createSignal(1);
  const [value] = createResource(signal, promise);
  await nextTick();
  resolve("item1");
  await nextTick();
  expect(value()).toBe("item1");
  expect(promise).toHaveBeenLastCalledWith(1);
  reset();
  setSignal(2);
  expect(promise).toHaveBeenLastCalledWith(2);
  resolve("item2");
  await nextTick();
  expect(value()).toBe("item2");
});

test("deferred", async () => {
  const { resolve, promise } = createDeferred();

  const p = promise();

  resolve("Hello World");

  const value = await p;

  expect(value).toBe("Hello World");
});

test("deferred fails", async () => {
  const { reject, promise } = createDeferred();
  const p = promise();
  reject("Whoops!");
  let error = "";
  try {
    await p;
  } catch (err) {
    error = `${err}`;
  }
  expect(error).toBe("Whoops!");
});

function nextTick(fn?: () => void) {
  return new Promise<void>((res) =>
    setTimeout(() => {
      fn && fn();
      return res();
    }, 0),
  );
}

function createDeferred<T>() {
  let _resolve: (value: T) => void = () => {};
  let _reject: (reason: string) => void = () => {};
  let _promise: () => Promise<T>;
  function resolve(v: T) {
    _resolve(v);
  }

  function reject(v: string) {
    return _reject(v);
  }

  const promise = vi.fn((_v?: T) => {
    return _promise();
  });

  function reset() {
    _promise = () =>
      new Promise<T>((r, f) => {
        _resolve = r;
        _reject = f;
      });
  }
  reset();
  return { resolve, reject, promise, reset };
}
