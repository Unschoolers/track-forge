package io.trackforge.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Native lifecycle action; confirmation belongs to the shared web UI. */
@CapacitorPlugin(name = "TrackForgeApp")
public class TrackForgeAppPlugin extends Plugin {
    @PluginMethod
    public void exit(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            call.resolve();
            getActivity().finish();
        });
    }
}
