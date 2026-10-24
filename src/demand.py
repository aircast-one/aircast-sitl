import asyncio
import json
import os

import websockets


async def main():
    async with websockets.connect('ws://127.0.0.1:8889') as bridge:
        await bridge.send(json.dumps({'type': 'CAMERA_DEMAND', 'feed': os.environ['MTX_PATH']}))
        async for _ in bridge:
            pass


if __name__ == '__main__':
    asyncio.run(main())
