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
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;
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
        volatile PluginCall pending;
        volatile boolean launchedOnMain;
        @Override public Context getContext() { return RuntimeEnvironment.getApplication(); }
        @Override public void startActivityForResult(PluginCall call, Intent intent, String callback) {
            pending = call;
            launchedOnMain = Looper.myLooper() == Looper.getMainLooper();
        }
    }

    private static void awaitDocumentPicker(Exporter plugin) throws Exception {
        long deadline = System.nanoTime() + 10_000_000_000L;
        while (plugin.pending == null && System.nanoTime() < deadline) {
            shadowOf(Looper.getMainLooper()).idle();
            Thread.sleep(10);
        }
        shadowOf(Looper.getMainLooper()).idle();
        assertNotNull("Document picker was not launched", plugin.pending);
    }

    @Test public void largeTrackDoesNotEnterActivitySavedState() throws Exception {
        String content = "{\"track\":\"" + "é漢".repeat(600_000) + "\"}";
        JSObject data = new JSObject();
        data.put("filename", "large.trackforge.json");
        data.put("content", content);
        PluginCall call = new PluginCall(null, "TrackExport", "1", "save", data);
        Exporter plugin = new Exporter();
        plugin.save(call);
        awaitDocumentPicker(plugin);
        assertNull("Large JSON must not remain in plugin options", plugin.pending.getString("content"));
        String id = plugin.pending.getString("exportId");
        assertNotNull(id);

        // Actual Capacitor saved-state path: the entire PluginCall options JSON
        // becomes a string in an Android Bundle/Parcel.
        Bundle savedState = new Bundle();
        savedState.putString("pluginOptions", plugin.pending.getData().toString());
        Parcel parcel = Parcel.obtain();
        try {
            savedState.writeToParcel(parcel, 0);
            assertTrue("Track JSON must stay out of the activity transaction: " + parcel.dataSize(), parcel.dataSize() < 8192);
        } finally { parcel.recycle(); }
        assertTrue("Document picker launches on the UI thread", plugin.launchedOnMain);

        File staged = TrackExportPlugin.stagedFile(plugin.getContext(), id);
        assertTrue("Track must survive until picker finishes", staged.isFile());
        ByteArrayOutputStream destination = new ByteArrayOutputStream();
        TrackExportPlugin.copyStaged(plugin.getContext(), id, destination);
        assertArrayEquals("Export must be byte-for-byte lossless", content.getBytes(StandardCharsets.UTF_8), destination.toByteArray());
        TrackExportPlugin.deleteStaged(plugin.getContext(), id);
        assertFalse("Temporary export must be cleaned up", staged.exists());
    }

    @Test public void stagedExportRejectsPathTraversal() {
        try {
            TrackExportPlugin.stagedFile(RuntimeEnvironment.getApplication(), "../../secrets");
            fail("Rejected invalid identifier");
        } catch (IllegalArgumentException expected) {
            // User-provided filenames never determine private cache paths.
        }
    }
}
