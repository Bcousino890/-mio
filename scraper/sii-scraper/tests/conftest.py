import pytest

# pytest-asyncio en modo auto: los tests `async def` corren sin marcador.
pytest_plugins = ()


def pytest_configure(config):
    config.addinivalue_line("markers", "asyncio: marca test asíncrono")
