1) Yes, the map view should be a view mode toggle. `m` is fine. The map view should be the default view for a human user.

2) Yes, the scrolling viewport is the best option for small terminals, I think. Are there other games that handle this differently? A scaled view might be tight beyond a certain width.

3) Lines at box edges, but I think we need to do orthogonal routing in v1. I don't think there are many issues in a typical Risk-style board, but we should have it look its best.

4) We should be able to provide layout files for custom maps. Do we need a supporting folder structure? Is `maps/` ok? I think by default the layout should be expected to be a part of the `foo.json` file. Maybe a separate , optional struct, but it should be in the same file. Let's discuss the needs of that filetype and if it's too complicated to support, or if it's too limiting (we might want to have different graphical representations of the same map tree), let's figure it out.

5) I would like to have able to show army counts, your proposal for compact notation is correct.

6) That's fine to defer, but we should have a design proposal for the animation system. I think that's a part of `SwiftCLIKit` anyway.
