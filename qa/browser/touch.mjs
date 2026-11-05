/** Inject genuine Chromium touch contacts, including concurrent fingers. */
export async function touch(session, type, points = []) {
  await session.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map(({ id, x, y }) => ({
      id,
      x: Math.round(x),
      y: Math.round(y),
      radiusX: 5,
      radiusY: 5,
      force: 0.8,
    })),
  })
}

export async function releaseTouches(session) {
  await touch(session, 'touchEnd', [])
}

export function contact(id, x, y) {
  return { id, x, y }
}
