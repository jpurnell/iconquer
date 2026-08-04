1) UnifiedMapFile should live in a shared module. This work now is in support of iConquer in the command line, but should be able to scale up to any type of app experience - macOS, iOS, MCP, web, android, and maybe even visionOS. We should think about what the visionOS version would entail. While traditional Risk is 2-dimensional, there could be a 3-dimensional version of the game that we should provision for in our file structure now.

2) I don't think we need inheritance. A single file should be enough

3) Yeah, that can be a load issue. That said, there's a world in which we build a separate map builder app that can do that linting. Let's mark that map builder as a potential TODO by adding a folder to `project/plans` called `IDEAS/` and save a quick conceptual overview called `mapBuilder.md` to that folder.

4) The router is specific to `iConquer` (multiple OSes and experiences) more broadly than `iConquerCLI`, isn't it? Let's discuss.

5) the format guide should live in `Docs/`, that's right.
