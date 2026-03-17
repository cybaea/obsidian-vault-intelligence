# Using MCP Servers

## Note for flatpak users

If Obsidian is installed using flatpak, like the default on Fedora Linux, then you should use `flatpak-spawn` to run the MCP server.

First, enable D-bus access for Obsidian (you only need to do this once):

```bash
flatpak override --user --talk-name=org.freedesktop.Flatpak md.obsidian.Obsidian
```

Make sure you restart Obsidian after running this command. It is not sufficient to reload it: you must exit completely.

Then, in the MCP Tools settings, use `flatpak-spawn` as the command. For the arguments, place each one on separate lines, for example:

```
--host
uvx
--from
git+https://github.com/rhel-lightspeed/linux-mcp-server.git
linux-mcp-server
```
