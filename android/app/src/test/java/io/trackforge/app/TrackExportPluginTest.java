package io.trackforge.app;

import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Looper;
import android.os.Parcel;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;

@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, sdk = 35)
@LooperMode(LooperMode.Mode.PAUSED)
public class TrackExportPluginTest {
    static class Exporter extends TrackExportPlugin {
        PluginCall pending;
        boolean launchedOnMain;
        @Override public Context getContext() { return RuntimeEnvironment.getApplication(); }
        @Override public void startActivityForResult(PluginCall call, Intent intent, String callback) {
            pending = call;
            launchedOnMain = Looper.myLooper() == Looper.getMainLooper();
        }
    }

    @Test public void largeTrackDoesNotEnterActivitySavedState() throws Exception {
        String content = "{\"track\":\"" + "é漢".repeat(600_000) + "\"}";
        JSObject data = new JSObject();
        data.put("filename", "large.trackforge.json");
        data.put("content", content);
        PluginCall call = new PluginCall(null, "TrackExport", "1", "save", data);
        Exporter plugin = new Exporter();
        Thread worker = new Thread(() -> plugin.save(call));
        worker.start(); worker.join();
        shadowOf(Looper.getMainLooper()).idle();
        assertNotNull(plugin.pending);
        // Capacitor saves call.getData() as a JSON string in an Android Bundle.
        Bundle savedState = new Bundle();
        savedState.putString("pluginOptions", plugin.pending.getData().toString());
        Parcel parcel = Parcel.obtain();
        try {
            savedState.writeToParcel(parcel, 0);
            assertTrue("Track JSON must stay out of the activity transaction: " + parcel.dataSize(), parcel.dataSize() < 8192);
        } finally { parcel.recycle(); }
        assertTrue("Document picker launches on the UI thread", plugin.launchedOnMain);
    }
}
