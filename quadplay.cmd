@rem Check if "py.exe" launcher is installed on Windows. Prefer using that (the
@rem python executable might be a shim that opens the Windows store)

where.exe "py.exe"
if %ERRORLEVEL% EQU 0 (
    @py -3 quadplay %*
) else (
    @python quadplay %*
)

