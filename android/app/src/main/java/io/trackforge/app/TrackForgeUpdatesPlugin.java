package io.trackforge.app;

import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.os.Environment;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Download an official GitHub Release APK via Android's system Download Manager. */
@CapacitorPlugin(name = "TrackForgeUpdates")
public class TrackForgeUpdatesPlugin extends Plugin {
    @PluginMethod
    public void progress(PluginCall call) {
        Long downloadId = call.getLong("downloadId");
        if (downloadId == null || downloadId <= 0) {
            call.reject("Invalid download ID.");
            return;
        }
        DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            call.reject("Android Download Manager is unavailable.");
            return;
        }
        try (android.database.Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(downloadId))) {
            if (cursor == null || !cursor.moveToFirst()) {
                call.reject("Download no longer exists.");
                return;
            }
            long downloaded = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
            long total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            JSObject result = new JSObject();
            result.put("downloaded", downloaded);
            result.put("total", total);
            result.put("state", status == DownloadManager.STATUS_SUCCESSFUL ? "complete"
                    : status == DownloadManager.STATUS_FAILED ? "failed"
                    : status == DownloadManager.STATUS_PAUSED ? "paused"
                    : status == DownloadManager.STATUS_RUNNING ? "downloading" : "pending");
            call.resolve(result);
        } catch (RuntimeException error) {
            call.reject("Could not read download progress.", error);
        }
    }

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        String version = call.getString("version");
        if (url == null || version == null ||
                !version.matches("android-build-[0-9]+-[0-9]+") ||
                !url.equals("https://github.com/Unschoolers/track-forge/releases/download/" + version + "/trackforge-debug.apk")) {
            call.reject("Invalid official Track Forge release URL.");
            return;
        }
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle("Track Forge " + version);
            request.setDescription("Game update APK");
            request.setMimeType("application/vnd.android.package-archive");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "trackforge-" + version + ".apk");
            DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) {
                call.reject("Android Download Manager is unavailable.");
                return;
            }
            long downloadId = manager.enqueue(request);
            JSObject result = new JSObject();
            result.put("downloadId", downloadId);
            call.resolve(result);
        } catch (RuntimeException error) {
            call.reject("Could not start APK download.", error);
        }
    }
}
