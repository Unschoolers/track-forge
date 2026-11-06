package io.trackforge.app;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "TrackExport")
public class TrackExportPlugin extends Plugin {
    @PluginMethod
    public void save(PluginCall call) {
        String content = call.getString("content");
        String filename = call.getString("filename");
        if (content == null || filename == null) {
            call.reject("Track export is missing its content or filename.");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(call, intent, "fileSelected");
    }

    @ActivityCallback
    private void fileSelected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK) {
            JSObject response = new JSObject();
            response.put("saved", false);
            call.resolve(response);
            return;
        }
        Intent data = result.getData();
        if (data == null || data.getData() == null) {
            call.reject("No export destination selected.");
            return;
        }
        try (OutputStream stream = getContext().getContentResolver().openOutputStream(data.getData(), "wt")) {
            if (stream == null) throw new java.io.IOException("Cannot open destination.");
            stream.write(call.getString("content", "").getBytes(StandardCharsets.UTF_8));
            stream.flush();
        } catch (Exception error) {
            call.reject("Track could not be exported.", error);
            return;
        }
        JSObject response = new JSObject();
        response.put("saved", true);
        call.resolve(response);
    }
}
