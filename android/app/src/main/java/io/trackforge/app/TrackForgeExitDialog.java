package io.trackforge.app;

import android.app.Activity;
import android.app.Dialog;
import android.view.LayoutInflater;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;

/** Native fallback for Back on Home, styled like Track Forge's in-game modals. */
final class TrackForgeExitDialog {
    private TrackForgeExitDialog() {}

    static Dialog create(Activity activity, Runnable onExit) {
        View content = LayoutInflater.from(activity).inflate(R.layout.dialog_exit_track_forge, null);
        Dialog dialog = new Dialog(activity);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        dialog.setContentView(content);
        dialog.setCanceledOnTouchOutside(true);

        content.findViewById(R.id.exit_dialog_stay).setOnClickListener(view -> dialog.dismiss());
        content.findViewById(R.id.exit_dialog_confirm).setOnClickListener(view -> {
            dialog.dismiss();
            onExit.run();
        });

        dialog.setOnShowListener(ignored -> {
            Window window = dialog.getWindow();
            if (window == null) return;
            float density = activity.getResources().getDisplayMetrics().density;
            int screenWidth = activity.getResources().getDisplayMetrics().widthPixels;
            WindowManager.LayoutParams params = window.getAttributes();
            params.width = Math.min(Math.round(screenWidth * 0.88f), Math.round(440 * density));
            params.height = WindowManager.LayoutParams.WRAP_CONTENT;
            params.dimAmount = 0.82f;
            window.setBackgroundDrawableResource(android.R.color.transparent);
            window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            window.setAttributes(params);
        });

        return dialog;
    }
}
