package io.trackforge.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "TrackExport")
public class TrackExportPlugin extends Plugin {
    private static final String EXPORT_DIRECTORY = "trackforge-exports";
    private static final String SHARE_DIRECTORY = "trackforge-shares";
    private static final long STALE_AFTER_MS = 24L * 60 * 60 * 1000;
    private static final ExecutorService IO = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "trackforge-export-io");
        thread.setDaemon(true);
        return thread;
    });
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @PluginMethod
    public void save(PluginCall call) {
        // Do not open ACTION_CREATE_DOCUMENT with the full JSON still inside a
        // PluginCall. Capacitor persists call.getData() into Activity saved state.
        // Large tracks otherwise cause TransactionTooLargeException on Android.
        final String content = call.getString("content");
        final String filename = call.getString("filename");
        if (content == null || filename == null || filename.isEmpty()) {
            call.reject("Track export is missing its content or filename.");
            return;
        }
        IO.execute(() -> {
            String id = UUID.randomUUID().toString();
            File staged = stagedFile(getContext(), id);
            try {
                cleanupStale(getContext());
                File directory = staged.getParentFile();
                if (directory == null || (!directory.isDirectory() && !directory.mkdirs())) {
                    throw new IOException("Cannot create temporary export directory.");
                }
                // Streaming UTF-8 encoding avoids an additional multi-megabyte
                // byte[] allocation on top of Capacitor's incoming JSON string.
                try (BufferedWriter writer = new BufferedWriter(
                        new OutputStreamWriter(new FileOutputStream(staged), StandardCharsets.UTF_8))) {
                    writer.write(content);
                }
                // Only the small UUID survives the document picker / process
                // recreation. The private file survives Activity reconstruction.
                call.getData().remove("content");
                call.getData().put("exportId", id);
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                intent.putExtra(Intent.EXTRA_TITLE, filename);
                mainHandler.post(() -> {
                    try {
                        startActivityForResult(call, intent, "fileSelected");
                    } catch (Exception error) {
                        deleteStaged(getContext(), id);
                        call.reject("Could not open the file picker.", error);
                    }
                });
            } catch (Exception error) {
                staged.delete();
                call.reject("Track could not be prepared for export.", error);
            }
        });
    }

    @PluginMethod
    public void share(PluginCall call) {
        final String content = call.getString("content");
        final String filename = call.getString("filename");
        final String text = call.getString("text");
        if (content == null || filename == null || filename.isEmpty()) {
            call.reject("Track share is missing its content or filename.");
            return;
        }
        IO.execute(() -> {
            File staged = shareFile(getContext(), UUID.randomUUID().toString(), filename);
            try {
                cleanupStaleShares(getContext());
                if (!staged.getParentFile().mkdirs()) throw new IOException("Cannot create share directory.");
                try (BufferedWriter writer = new BufferedWriter(
                        new OutputStreamWriter(new FileOutputStream(staged), StandardCharsets.UTF_8))) {
                    writer.write(content);
                }
                call.getData().remove("content");
                Uri uri = FileProvider.getUriForFile(getContext(),
                        getContext().getPackageName() + ".shareprovider", staged);
                Intent chooser = Intent.createChooser(shareIntent(uri, text), "Share track");
                chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                mainHandler.post(() -> {
                    try {
                        getActivity().startActivity(chooser);
                        JSObject response = new JSObject();
                        response.put("shared", true);
                        call.resolve(response);
                    } catch (android.content.ActivityNotFoundException error) {
                        deleteShare(staged);
                        JSObject response = new JSObject();
                        response.put("shared", false);
                        call.resolve(response);
                    } catch (Exception error) {
                        deleteShare(staged);
                        call.reject("Could not open the share chooser.", error);
                    }
                });
            } catch (Exception error) {
                deleteShare(staged);
                call.reject("Track could not be prepared for sharing.", error);
            }
        });
    }

    static Intent shareIntent(Uri uri, String text) {
        Intent intent = new Intent(Intent.ACTION_SEND);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_STREAM, uri);
        if (text != null && !text.isEmpty()) intent.putExtra(Intent.EXTRA_TEXT, text);
        intent.setClipData(ClipData.newRawUri("Track Forge track", uri));
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        return intent;
    }

    static File shareFile(Context context, String id, String filename) {
        if (!validId(id)) throw new IllegalArgumentException("Invalid share identifier.");
        String name = filename.replace('\\', '/');
        name = name.substring(name.lastIndexOf('/') + 1).replaceAll("[^\\p{L}\\p{N}_.-]", "-");
        if (name.isEmpty() || name.equals(".") || name.equals("..")) name = "track.trackforge.json";
        if (name.length() > 50) name = name.substring(0, 50) + ".trackforge.json";
        return new File(new File(new File(context.getCacheDir(), SHARE_DIRECTORY), id), name);
    }

    private static void deleteShare(File file) {
        file.delete();
        File directory = file.getParentFile();
        if (directory != null) directory.delete();
    }

    private static void cleanupStaleShares(Context context) {
        File[] directories = new File(context.getCacheDir(), SHARE_DIRECTORY).listFiles();
        if (directories == null) return;
        long threshold = System.currentTimeMillis() - STALE_AFTER_MS;
        for (File directory : directories) {
            if (!directory.isDirectory() || !validId(directory.getName()) || directory.lastModified() >= threshold) continue;
            File[] files = directory.listFiles();
            if (files != null) for (File file : files) if (file.isFile()) file.delete();
            directory.delete();
        }
    }

    @ActivityCallback
    private void fileSelected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        String id = call.getString("exportId");
        if (!validId(id)) {
            call.reject("The pending export is missing or invalid.");
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK) {
            deleteStaged(getContext(), id);
            JSObject response = new JSObject();
            response.put("saved", false);
            call.resolve(response);
            return;
        }
        Intent resultData = result.getData();
        if (resultData == null || resultData.getData() == null) {
            deleteStaged(getContext(), id);
            call.reject("No export destination selected.");
            return;
        }

        // A large write must never block Android's activity-result/UI thread.
        final android.net.Uri destination = resultData.getData();
        IO.execute(() -> {
            try (OutputStream stream = getContext().getContentResolver().openOutputStream(destination, "wt")) {
                if (stream == null) throw new IOException("Cannot open destination.");
                copyStaged(getContext(), id, stream);
                stream.flush();
                JSObject response = new JSObject();
                response.put("saved", true);
                call.resolve(response);
            } catch (Exception error) {
                call.reject("Track could not be exported.", error);
            } finally {
                deleteStaged(getContext(), id);
            }
        });
    }

    private static boolean validId(String id) {
        if (id == null) return false;
        try {
            return UUID.fromString(id).toString().equals(id);
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    static File stagedFile(Context context, String id) {
        if (!validId(id)) throw new IllegalArgumentException("Invalid export identifier.");
        return new File(new File(context.getCacheDir(), EXPORT_DIRECTORY), id + ".json");
    }

    static void copyStaged(Context context, String id, OutputStream target) throws IOException {
        try (FileInputStream input = new FileInputStream(stagedFile(context, id))) {
            byte[] buffer = new byte[16 * 1024];
            int length;
            while ((length = input.read(buffer)) != -1) target.write(buffer, 0, length);
        }
    }

    static void deleteStaged(Context context, String id) {
        if (validId(id)) stagedFile(context, id).delete();
    }

    private static void cleanupStale(Context context) {
        File directory = new File(context.getCacheDir(), EXPORT_DIRECTORY);
        File[] files = directory.listFiles();
        if (files == null) return;
        long threshold = System.currentTimeMillis() - STALE_AFTER_MS;
        for (File file : files) {
            if (file.isFile() && file.getName().endsWith(".json") && file.lastModified() < threshold) {
                file.delete();
            }
        }
    }
}
